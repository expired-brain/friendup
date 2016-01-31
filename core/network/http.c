/*******************************************************************************
*                                                                              *
* This file is part of FRIEND UNIFYING PLATFORM.                               *
*                                                                              *
* This program is free software: you can redistribute it and/or modify         *
* it under the terms of the GNU Affero General Public License as published by  *
* the Free Software Foundation, either version 3 of the License, or            *
* (at your option) any later version.                                          *
*                                                                              *
* This program is distributed in the hope that it will be useful,              *
* but WITHOUT ANY WARRANTY; without even the implied warranty of               *
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the                 *
* GNU Affero General Public License for more details.                          *
*                                                                              *
* You should have received a copy of the GNU Affero General Public License     *
* along with this program.  If not, see <http://www.gnu.org/licenses/>.        *
*                                                                              *
*******************************************************************************/


#include <core/types.h>
#include <stdbool.h>
#include <stdlib.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "network/http.h"
#include "util/string.h"
#include <util/log/log.h>

//void HttpAddHeaderStatic( Http_t* http, char* key, const char* value )
//{
//	char* dvalue = calloc( strlen( value ) + 1 );
//
//}

// From main.c
extern pthread_mutex_t sslmut;

// Pretty inefficient, but what the heck...
char * Httpsprintf( char * format, ... )
{
	va_list argList;
	va_start( argList, format );
	char* str = FCalloc( (vsnprintf( NULL, 0, format, argList ) + 1), sizeof(char) );

	if( str == NULL )
	{
		ERROR("Cannot allocate memory in Httpsprintf\n");
		return NULL;
	}
	va_end( argList );
	va_start( argList, format );
	vsprintf( str, format, argList );
	va_end( argList );
	return str;
}

//
//
//

Http* HttpNew(  )
{
	Http* h = FCalloc( 1, sizeof( Http ) );
	h->headers = HashmapNew();

	// Set default version to HTTP/1.1
	h->versionMajor = 1;
	h->versionMinor = 1;
	//h->h_Socket = socket;
	
	DEBUG("HTTP_NEW SOCKET SET %p\n", socket );
	
	return h;
}

//
//
//

Http* HttpNewSimple( unsigned int code, struct TagItem *tag )
{
	Http* h = HttpNew( );
	if( h != NULL )
	{
		HttpSetCode( h, code );
		
		//INFO("==================================\n");

		while( tag->ti_Tag != TAG_DONE )
		{
			if( HttpAddHeader( h, tag->ti_Tag , (char *)tag->ti_Data )  != 0 )
			{
				ERROR("Cannot add key: %s\n", HEADERS[ tag->ti_Tag ] );
			}
			else
			{
				INFO("Added %s\n", (char *) tag->ti_Data );
			}
		
			tag++;
		}
	}
	else
	{
		ERROR("Cannot allocate memory for HTTP\n");
	}

	return h;
}

//
// Helper function to add some error codes to an object
//

Http* HttpError( unsigned int code, Http* http, unsigned int line )
{
	http->errorCode = code;
	http->errorLine = line;
	switch( code )
	{
		case 400:
			INFO( "400 Bad Request (%u)\n", line );
			break;
		default:
			INFO( "%u (%u)\n", code, line );
	}
	return http;
}

//
// any US-ASCII character (octets 0 - 127)
//

BOOL HttpIsChar( char c )
{
	return (unsigned char)c < 0x80;
}

//
// any US-ASCII control character (octets 0 - 31) and DEL (127)
//

BOOL HttpIsCTL( char c )
{
	return c < 0x20 || c == 0x7F;
}

//
//
//

BOOL HttpIsSeparator( char c )
{
	return 
	/* .--------------------------------------------. */
	/* | CHAR BINGO  || BOARD 15 || grandma   ||    | */
	/* +-------------++----------++-----------++----+ */
	/* | */ c == ' ' || c == '(' || c == ')'  || /* | */ 
	/* | */ c == '<' || c == '>' || c == '@'  || /* | */ 
	/* | */ c == ',' || c == ';' || c == '\\' || /* | */ 
	/* | */ c == '"' || c == '/' || c == '['  || /* | */ 
	/* | */ c == ']' || c == '?' || c == '='  || /* | */ 
	/* | */ c == '{' || c == '}' || c == 0x09;   /* | */
	/* '--------------------------------------------' */ 
}

//
//
//

inline BOOL HttpIsUpAlpha( char c )
{
	return c >= 'A' && c <= 'Z';
}

//
//
//

inline BOOL HttpIsLoAlpha( char c )
{
	return c >= 'a' && c <= 'z';
}

//
//
//

inline BOOL  HttpIsAlpha( char c )
{
	return HttpIsUpAlpha( c ) || HttpIsLoAlpha( c );
}

//
//
//

char HttpAlphaToLow( char c )
{
	if( HttpIsUpAlpha( c ) )
	{
		return c | 0x20;
	}
	return c;
}

//
//
//

inline BOOL HttpIsToken( char c )
{
	return !( HttpIsCTL( c ) || HttpIsSeparator( c ) ) && HttpIsChar( c );
}

//
//
//

inline BOOL HttpIsWhitespace( char c )
{
	return c == ' ' || c == '\t';
}

//
// parse integer value
//

int HttpParseInt( char* str )
{
	unsigned int len = strlen( str );
	unsigned int i = 0;
	int v = 0;
	bool negative = false;
	if( str[0] == '-' )
	{
		negative = true;
		i++;
	}
	else if( str[0] == '+' )
	{
		i++;
	}
	for( unsigned int i = 0; i < len; i++ )
	{	
		if( str[i] >= '0' && str[i] <= '9' )
		{
			v = ( v * 10 ) + ( str[i] - '0' );
		}
		else
		{
			break;
		}
	}
	if( negative )
	{
		return -v;
	}
	else
	{
		return v;
	}
}

//
//
//

int HttpParseHeader( Http* http, const char* request, unsigned int length )
{
	// TODO: Better response codes
	//
	// https://www.ietf.org/rfc/rfc2616.txt
	// http://tools.ietf.org/html/rfc7230 <- Better!

	char* r = (char*)request;

	// Parse request header
	char* ptr = r;
	int step = -1;
	int substep = 0;
	bool emptyLine = false;
	bool lookForFieldName = true;
	char* currentToken = 0;
	char* lineStartPtr = r;
	char* fieldValuePtr = 0;
	unsigned int i = 0;
	
	//INFO("REQUEST size %d %s\n", length, request );

	// Ignore any CRLF's that may precede the request-line
	while( true )
	{
		if( r[i] != '\r' && r[i] != '\n' )
		{
			step++;
			break;
		}
		i++;
	}

	// Parse
	for( ; true; i++ )
	{
		// Sanity check
		if( i > length )
		{
			return 400;
		}

		// Request-Line
		if( step == 0 )
		{
			if( r[i] == ' ' || r[i] == '\r' || r[i] == '\n' )
			{
				switch( substep )
				{
					// Method -----------------------------------------------------------------------------------------
					case 0:
						http->method = StringDuplicateN( ptr, ( r + i ) - ptr );
						StringToUppercase( http->method );

						// TODO: Validate method
						break;
					// Path and Query ---------------------------------------------------------------------------------
					case 1:
					{
						http->rawRequestPath = StringDuplicateN( ptr, ( r + i ) - ptr );
						http->uri = UriParse( http->rawRequestPath );
						if( http->uri && http->uri->query )
						{
							http->query = http->uri->query;
						}
						break;
					}
					// Version ----------------------------------------------------------------------------------------
					case 2:
						http->version = StringDuplicateN( ptr, ( r + i ) - ptr );
						unsigned int strLen = strlen( http->version );

						// Do we have AT LEAST "HTTPxxxx"?
						// TODO: What if we have HTTPaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1/1?
						if( strLen < 8 || memcmp( http->version, "HTTP", 4 ) )
						{
							return 400;
						}

						// Find the version separator
						char* p = strchr( http->version, '/' );
						if( !p )
						{
							return 400;
						}
						p++;

						unsigned int pOffset = p - http->version;
						unsigned int v = 0;
						bool major = true;
						for( unsigned int j = 0; pOffset + j < strLen; j++ )
						{
							// Parse number
							if( p[j] >= '0' && p[j] <= '9' )
							{
								v = ( v * 10 ) + ( p[j] - '0' );
							}
							// Save major version
							else if( p[j] == '.' )
							{
								if( major )
								{
									http->versionMajor = v;
								}
								else
								{
									return 400;
								}
								major = false;
								v = 0;
							}
							// Invalid version numbering!
							else
							{
								return 400;
							}
						}
						http->versionMinor = v;
						break;
					// ------------------------------------------------------------------------------------------------
					default:
						// Any more than 3 segments in the request line is a bad request
						return 400;
				}
				substep++;
				ptr = r + i + 1;
			}
		}
		// Additional header lines
		else
		{
			if( r[i] != '\r' && r[i] != '\n' )
			{
				emptyLine = false;

				if( lookForFieldName )
				{
					// Make sure the field name is a valid token until we hit the : separator
					if( !HttpIsToken( r[i] ) && r[i] != ':' )
					{
						return 400;
					}
					if( r[i] == ':' )
					{
						unsigned int tokenLength = ( r + i ) - lineStartPtr;
						currentToken = StringDuplicateN( lineStartPtr, tokenLength );
						
						for( unsigned int j = 0; j < tokenLength; j++ )
						{
							currentToken[j] = HttpAlphaToLow( currentToken[j] );
						}
						lookForFieldName = false;
					}
				}
				else
				{
					if( !fieldValuePtr && r[i] != ' ' && r[i] != 0x09 )
					{
						fieldValuePtr = r + i;
					}
				}
			}
			else if( !lookForFieldName )
			{
				// Example value: "    \t lolwat,      hai,yep   "
				unsigned int valLength = ( r + i ) - fieldValuePtr;
				char* value = StringDuplicateN( fieldValuePtr, valLength );
				List* list = CreateList();

				// Do not split Set-Cookie field
				if( strcmp( currentToken, "set-cookie" ) == 0 )
				{
					AddToList( list, value );
				}
				// Split by comma
				else
				{
					char* ptr = value;
					unsigned int lastCharIndex = 0;
					bool leadingWhitespace = true;
					for( unsigned int i = 0; i < valLength; i++ )
					{
						// Ignore leading whitespace
						if( leadingWhitespace && HttpIsWhitespace( value[i] ) )
						{
							ptr = value + i + 1;
							lastCharIndex++;
						}
						else
						{
							leadingWhitespace = false;

							// Comma is the separator
							if( value[i] == ',' )
							{
								char* v = StringDuplicateN( ptr, lastCharIndex - ( ptr - value ) );
								
								AddToList( list, v );
								
								leadingWhitespace = true;
								ptr = value + i + 1;
								lastCharIndex++;
							}
							// Ignore trailing whitespace
							else if( !HttpIsWhitespace( value[i] ) )
							{
								lastCharIndex++;
							}
						}
					}
					// Add the last value in the lift, if there are any left
					if( !leadingWhitespace )
					{
						char* v = StringDuplicateN( ptr, lastCharIndex - ( ptr - value ) );
						AddToList( list, v );
					}
					free( value );
				}

				HashmapPut( http->headers, currentToken, list );
			}
		}

		// Check for line ending
		// Even though the specs clearly say \r\n is the separator,
		// let's forgive some broken implementations! It's not a big deal.
		if( r[i] == '\n' || r[i] == '\r' )
		{
			// Reset and update some vars
			step++;
			substep = 0;
			if( r[i+1] == '\n' )
			{
				i++;
			}

			lineStartPtr = r + i + 1;

			// Time to end?
			if( emptyLine )
			{
				break;
			}
			emptyLine = true;
			lookForFieldName = true;
			fieldValuePtr = 0;
		}
	}
	if( r[i] == '\r' )
	{
		i++; // In case we ended on a proper \r\n note, we need to adjust i by 1 to get to the beginning of the content (if any)
	}

	return 1;
}


//
// Find string in data
//

char *FindStrInData( char *str, char *data, int length)
{
	int pos = 0;
	int slen = strlen(str);
	while( pos < length - slen )
	{
		int i = 0;
		while( i < slen && str[ i ] == data[ pos + i ] )
		{
			//printf("%d\n", i );
			i++;
		}
		
		if ( i == slen )
		{
			return data + pos;
		}
		pos++;
	}
	return NULL;
}


//
//
//

int ParseMultipart( Http* http )
{
	http->parsedPostContent = HashmapNew();
	if( http->parsedPostContent == NULL )
	{
		ERROR("Map was not created\n");
		return -1;
	}

	INFO("Multipart parsing\n");
	
	
	/*
	 * Content-Disposition: form-data; name="sessionid"

f0fc966084ebceefb32862f6d8255f3f8a47c52c
------WebKitFormBoundaryyhHTTYrmbVyzL3Ns
Content-Disposition: form-data; name="module"

files
------WebKitFormBoundaryyhHTTYrmbVyzL3Ns
Content-Disposition: form-data; name="command"

uploadfile
------WebKitFormBoundaryyhHTTYrmbVyzL3Ns
Content-Disposition: form-data; name="args"

{'path':'Home:'}
------WebKitFormBoundaryyhHTTYrmbVyzL3Ns
Content-Disposition: form-data; name="file"; filename="project.properties"
Content-Type: application/octet-stream

	 */
	
//
	// Find files in http request
	//
	
	char *contentDisp = NULL;
	int numOfFiles = 0;
	char *dataPtr = http->content;
	while( TRUE )
	{
		if( ( contentDisp = strstr( dataPtr, "Content-Disposition: form-data; name=\"") ) != NULL )
		{
			char *nameEnd = strchr( contentDisp + 38, '"' );
			char *nextlineStart = strstr( nameEnd, "\r\n" ) + 2;
			
			//application/octet-stream
			if( strncmp( nextlineStart, "Content-Type: ", 14 ) == 0 )
			{
				//NFO("File found\n");
									
				//if( ( contentDisp = strstr( dataPtr, "Content-Disposition: form-data; name=\"file") ) != NULL )
				char *startOfFile = strstr( nextlineStart, "\r\n\r\n" ) + 4;
				if( startOfFile != NULL )
				{
					int  res = FindInBinaryPOS( http->h_PartDivider, strlen(http->h_PartDivider), startOfFile, http->sizeOfContent ) - 2;
					char *endOfFile = startOfFile + res;
					
					INFO("Found the end of the file, file size %d\n", res );
					
					if( endOfFile != NULL )
					{
						char *fname = strstr( contentDisp, "filename=\"" ) + 10;
						if( fname != NULL )
						{
							char *fnameend = strchr( fname, '"' );
							QUAD size = (endOfFile - startOfFile);
							int fnamesize = (int)(fnameend - fname);
						
							HttpFile *newFile = HttpFileNew( fname, fnamesize, startOfFile, size );
							if( newFile != NULL )
							{
								//ERROR("TEMP POS %p END POS %p   size %d\n", startOfFile, endOfFile, (int)( endOfFile-startOfFile ) );
								//INFO("PARSING FOR FILES %40s =============== %p  filesize %ld\n", startOfFile, startOfFile, size );
								if( http->h_FileList == NULL )
								{
									http->h_FileList = newFile;
								}
								else
								{
									newFile->node.mln_Succ = (MinNode *)http->h_FileList;
									http->h_FileList = newFile;
								}
								numOfFiles++;
							}
						}
					}
				}
			}
			
			//
			// its not file its parameter
			//
			
			else
			{
				//ERROR("Data found\n");
				char *nameStart = contentDisp + 38;
				char *nameEnd = strchr( nameStart, '"' );
				char *key = StringDuplicateN( nameStart, (int)(nameEnd - nameStart) );
				
				char *startParameter = strstr( nextlineStart, "\r\n" ) + 2;
				char *endParameter = strstr( startParameter, "\r\n" );
				char *value = StringDuplicateN( startParameter, (int)(endParameter - startParameter) );
				
				/*
				TODO: Enable this when it does something..
				*/
				if( HashmapPut( http->parsedPostContent, key, value ) )
				{
					
				}
				/**/
				//INFO("============================---KEY: %s  VALUE %s---s<<----------\n", key, value );
			}
			

		}
		else break;
		
		int pos = ( int )( contentDisp - dataPtr ); 
		dataPtr += pos + 20;
	}
	
	INFO("Number of files in http request %d\n", numOfFiles );
	
	return 0;
}

//
//
//
		
extern inline int HttpParsePartialRequest( Http* http, char* data, unsigned int length )
{
	if( data == NULL || http == NULL )
	{
		ERROR("Cannot parse NULL requiest\n");
		return -1;
	}
	
	// Setting it up
	if( !http->partialRequest )
	{
		http->partialRequest = true;
		//DEBUG( "\nINCOMING!-----\n\n%s|Has come in.....\n", data );
		
		// Check if the recieved data exceeds the maximum header size. If it does, 404 dat bitch~
		// TODO

		// Search for \r\n\r\n in the recieved header
		// Needle in a haystack
		char* headerEnd = "\r\n\r\n";
		char* found = strstr( (char*)data, headerEnd );

		if( found )
		{
			int result = 0;
			int size = 0;
			char *content = NULL;
			
			if( !http->gotHeader )
			{
				http->gotHeader = true;
				HttpParseHeader( http, data, length );
			}
			if( ( content = HttpGetHeader( http, "content-length", 0 ) ) )
			{
				size = HttpParseInt( content );

				// If we have content, then parse it
				DEBUG( "[HttpParsePartialRequest] Size of content is %d\n", size );
				if( size )
				{
					DEBUG("Expecting BODY with a length of %d\n", size );
					http->expectBody = TRUE;
				
					if( http->content ) free( http->content );
					http->content = FCalloc( (size + 5), sizeof( char ) );
					http->sizeOfContent = size;
				
					// Add some extra data for content..
					int dataOffset = ( found - data + 4 );
					int dataLength = length - dataOffset;
					if( dataLength <= 0 )
					{
						// ERROR!
						DEBUG( "Data length is less or equal to than 0 (%d) Missing data in post.\n", dataLength );
						//DEBUG( "Adding content (offset %d with dataLength %d of total %d) Content body size was: %d.\n", dataOffset, dataLength, length, size );
						free( http->content );
						http->content = NULL;
						http->sizeOfContent = 0;
						http->expectBody = FALSE;
						return result != 400;
					}
					else if( dataLength != size )
					{
						DEBUG( "Datalength != Size %d != %d\n", dataLength, size );
						free( http->content );
						http->content = NULL;
						http->sizeOfContent = 0;
						http->expectBody = FALSE;
						return result != 400;
					}
					DEBUG( "We have: %s\n", found + 4 );
					DEBUG( "Adding content (of total size %d of total %d) Content size was: %d.\n", dataLength, length, size );
					int r = HttpParsePartialRequest( http, found + 4, size );
					return r;
				}
				else
				{
					DEBUG( "Ok, we say ONE (we have no size, nothing in content)\n" );
					return 1;
				}
			}
			else
			{
				DEBUG("NO MORE DATA\n");
				// No more data, we're done parsing
				return result != 400;
			}
		}
		else
		{
			DEBUG("RET 0!\n");
			return 0;
		}
	}
	
	if( http->gotHeader && http->expectBody && http->content )
	{
		DEBUG("RECEIVE DATA, length %d\n", length );
		
		// If we have null data, just purge!
		if( length > 0 )
		{
			memcpy( http->content, data, length );
			
			char *endDivider = strstr( http->content, "\r\n" );
			memset( http->h_PartDivider, 0, 256*sizeof(char ) );
			if( endDivider != NULL )
			{
				strncpy( http->h_PartDivider, http->content, endDivider-http->content );
			}
			else
			{
				strcpy( http->h_PartDivider, "\n");
			}
			DEBUG("Divider: %s\n", http->h_PartDivider );
		}
	
		if( length == http->sizeOfContent )
		{
			char* type = HttpGetHeader( http, "content-type", 0 );
			if( type )
			{
				// Some browser send "content-type; charset=x"
				unsigned int l = 0;
				char** a = StringSplit( type, ';', &l );

				if( strcmp( a[0], "application/x-www-form-urlencoded" ) == 0 )
				{
					http->h_ContentType = HTTP_CONTENT_TYPE_DEFAULT;
					
					DEBUG( "Ok, we\'re using post content..\n" );
					if( http->parsedPostContent )
					{
						HashmapFree( http->parsedPostContent );
					}
					
					http->parsedPostContent = UriParseQuery( http->content );
					
				}
				
				//
				// multipart
				//
				
				else if( strcmp( a[0], "multipart/form-data" ) == 0 )
				{
					http->h_ContentType = HTTP_CONTENT_TYPE_MULTIPART;
					
					if( http->parsedPostContent )
					{
						HashmapFree( http->parsedPostContent );
					}
					int ret = ParseMultipart( http );
				}
				
				unsigned int i;
				for( i = 0; i < l; i++ )
				{
					free( a[i] );
				}
				free( a );
			}
			
			
		}

		return 1;
	}
	else
	{
		ERROR("Could not find data\n");
	}
	
	return 0;
}
	
//
// Get the raw header list
//

List* HttpGetHeaderList( Http* http, const char* name )
{
	HashmapElement* e = HashmapGet( http->headers, (char*)name );
	if( e )
	{
		return e->data;
	}
	else
	{
		return NULL;
	}
}

//
// Get a header field value from a list at the index, or NULL if there is no values at the given index
//

char* HttpGetHeader( Http* http, const char* name, unsigned int index )
{
	HashmapElement* e = HashmapGet( http->headers, (char*)name );
	if( e )
	{
		List* l = e->data;
		char* f = l->data;
		for( unsigned int i = 0; i < index; i++ )
		{
			l = l->next;
			f = l->data;
		}
		return f;
	}
	else
	{
		return NULL;
	}
}

//
// Get the number of values this header contains
//

unsigned int HttpNumHeader( Http* http, const char* name )
{
	HashmapElement* e = HashmapGet( http->headers, (char*)name );
	if( e )
	{
		List* l = e->data;
		unsigned int num = 0;
		do
		{
			num++;
		}
		while( ( l = l->next ) != NULL );

		return num;
	}
	else
	{
		return 0;
	}
}

//
// Check if the request contains a header with the given value
//

BOOL HttpHeaderContains( Http* http, const char* name, const char* value, BOOL caseSensitive )
{
	HashmapElement* e = HashmapGet( http->headers, (char*)name );
	if( e )
	{		
		unsigned int i = 0;
		unsigned int size = strlen( value );
		
		// Precalc lowercase value
		char valueLowcase[ size ];
		for( ; i < size; i++ ) valueLowcase[ i ] = HttpAlphaToLow( value[i] );
		
		List* l = e->data;
		do
		{
			i = 0;
			char* data = (char*) l->data;
			while( data[i] && i < size )
			{
				if(
					( !caseSensitive ? HttpAlphaToLow( data[ i ] ) : data[ i ] ) != 
					( !caseSensitive ? valueLowcase[ i ] : value[ i ] )
				)
				{
					break;
				}
				i++;
				
			}
			if( i == size )
			{
				return true;
			}
		}
		while( ( l = l->next ) != NULL );

		return false;
	}
	else
	{
		return false;
	}
}

//
//
//

void HttpFree( Http* http )
{
	//DEBUG("Free HashMap\n");
	int i;
	for( i = 0 ; i < HTTP_HEADER_END ; i++ )
	{
		if( http->h_RespHeaders[ i ] != NULL )
		{
			FFree( http->h_RespHeaders[ i ]  );
			http->h_RespHeaders[ i ] = NULL;
		}
	}
	
	// Only free the headers hashmap
	if( http->headers != NULL )
	{
		HashmapFree( http->headers );
	}
	//DEBUG("Headers freed\n");
	
	if( http->response )
	{
		free( http->response );
	}
	if( http->content )
	{
		free( http->content );
	}
	if( http->parsedPostContent != NULL )
	{
		HashmapFree( http->parsedPostContent );
	}
	//DEBUG("Remove files\n");
	
	// Free files
	HttpFile *curFile = http->h_FileList;
	HttpFile *remFile = curFile;
	while( curFile != NULL )
	{
		remFile = curFile;
		curFile = ( HttpFile * )curFile->node.mln_Succ;
		HttpFileDelete( remFile );
	}
	//DEBUG("Free http\n");
	
	// Suicide
	free( http );
}

//
//
//

void HttpFreeRequest( Http* http )
{
	// Free the raw data we got from the request
	if( http->method != NULL )
	{
		free( http->method );
		http->method = NULL;
	}
	if( http->uri != NULL )
	{
		UriFree( http->uri );
		http->uri = NULL;
	}
	if( http->rawRequestPath != NULL )
	{
		free( http->rawRequestPath );
		http->rawRequestPath = NULL;
	}
	if( http->version != NULL )
	{
		free( http->version );
		http->version = NULL;
	}
	if( http->content != NULL && http->sizeOfContent != 0 )
	{
		free( http->content );
		http->content = NULL;
		http->sizeOfContent = 0;
	}

	// Free the query hashmap
	/*
	if( http->query )
	{
		unsigned int iterator = 0;
		HashmapElement_t* e = NULL;
		while( ( e = HashmapIterate( http->query, &iterator ) ) != NULL )
		{
			if( e->data != NULL )
				free( e->data );
			e->data = NULL;
			free( e->key );
			e->key = NULL;
		}
		HashmapFree( http->query );
		http->query = NULL;
	}
	*/

	// Free the headers hashmap
	unsigned int iterator = 0;
	HashmapElement* e = NULL;
	while( ( e = HashmapIterate( http->headers, &iterator ) ) != NULL )
	{
		if( e->data != NULL )
		{
			List* l = (List*)e->data;
			List* n = NULL;
			do
			{
				if( l->data )
				{
					free( l->data );
					l->data = NULL;
				}
				n = l->next;
				free( l );
				l = n;
			} while( l );
			e->data = NULL;
		}
		free( e->key );
		e->key = NULL;
	}
	
	HashmapFree( http->headers );

	if( http->partialData ) free( http->partialData );

	if( http->parsedPostContent ) HashmapFree( http->parsedPostContent );

	// Free files
	HttpFile *curFile = http->h_FileList;
	HttpFile *remFile = curFile;
	while( curFile != NULL )
	{
		remFile = curFile;
		curFile = (HttpFile *)curFile->node.mln_Succ;
		HttpFileDelete( remFile );
	}
	DEBUG("Free http\n");

	// Suicide
	free( http );
}

//
//
//

void HttpSetCode( Http* http, unsigned int code )
{
	http->responseCode = code;
	switch( code )
	{
		case 100: http->responseReason = "Continue"; break;
		case 101: http->responseReason = "Switching Protocols"; break;
		case 102: http->responseReason = "Processing"; break;                      // WebDAV; RFC 2518

		case 200: http->responseReason = "OK"; break;
		case 201: http->responseReason = "Created"; break;
		case 202: http->responseReason = "Accepted"; break;
		case 203: http->responseReason = "Non-Authoritative Information"; break;
		case 204: http->responseReason = "No Content"; break;
		case 205: http->responseReason = "Reset Content"; break;
		case 206: http->responseReason = "Partial Content"; break;
		case 207: http->responseReason = "Multi-Status"; break;                    // WebDAV; RFC 4918
		case 208: http->responseReason = "Already Reported"; break;                // WebDAV; RFC 6842
		case 225: http->responseReason = "IM Used"; break;                         // RFC 3229

		case 300: http->responseReason = "Multiple Choices"; break;
		case 301: http->responseReason = "Moved Permanently"; break;
		case 302: http->responseReason = "Found"; break;
		case 303: http->responseReason = "See Other"; break;
		case 304: http->responseReason = "Not Modified"; break;
		case 305: http->responseReason = "Use Proxy"; break;
		case 307: http->responseReason = "Temporary Redirect"; break;
		case 308: http->responseReason = "Permanent Redirect"; break;              // Experimental RFC; RFC 7238

		case 400: http->responseReason = "Bad Request"; break;
		case 401: http->responseReason = "Unauthorized"; break;
		case 402: http->responseReason = "Payment Required"; break;
		case 403: http->responseReason = "Forbidden"; break;
		case 404: http->responseReason = "Not Found"; break;
		case 405: http->responseReason = "Method Not Allowed"; break;
		case 406: http->responseReason = "Not Acceptable"; break;
		case 407: http->responseReason = "Proxy Authentication Required"; break;
		case 408: http->responseReason = "Request Time-out"; break;
		case 409: http->responseReason = "Conflict"; break;
		case 410: http->responseReason = "Gone"; break;
		case 411: http->responseReason = "Length Required"; break;
		case 412: http->responseReason = "Precondition Failed"; break;
		case 413: http->responseReason = "Request Entity Too Large"; break;
		case 414: http->responseReason = "Request-URI Too Large"; break;
		case 415: http->responseReason = "Unsupported Media Type"; break;
		case 416: http->responseReason = "Requested range not satisfiable"; break;
		case 417: http->responseReason = "Expectation Failed"; break;
		case 418: http->responseReason = "I'm a teapot"; break;                    // RFC 2324
		case 422: http->responseReason = "Unprocessable Entity"; break;            // WebDAV; RFC 4918
		case 423: http->responseReason = "Locked"; break;                          // WebDAV; RFC 4918
		case 424: http->responseReason = "Failed Dependency"; break;               // WebDAV; RFC 4918
		case 426: http->responseReason = "Upgrade Required"; break;
		case 428: http->responseReason = "Precondition Failed"; break;             // RFC 6585
		case 429: http->responseReason = "Too Many Requests"; break;               // RFC 6585
		case 431: http->responseReason = "Request Header Fields Too Large";        // RFC 6585
		case 451: http->responseReason = "Unavailable For Legal Reasons"; break;

		case 500: http->responseReason = "Internal Server Error"; break;
		case 501: http->responseReason = "Not Implemented"; break;
		case 502: http->responseReason = "Bad Gateway"; break;
		case 503: http->responseReason = "Service Unavailable"; break;
		case 504: http->responseReason = "Gateway Time-out"; break;
		case 505: http->responseReason = "HTTP Version not supported"; break;
		case 506: http->responseReason = "Variant Also Negotiates"; break;         // RFC 2295
		case 507: http->responseReason = "Insufficient Storage"; break;            // WebDAV; RFC 4918
		case 508: http->responseReason = "Loop Detected"; break;                   // WebDAV; RFC 5842
		case 510: http->responseReason = "Not Extended"; break;                    // RFC 2774
		case 511: http->responseReason = "Network Authentication Required"; break; // RFC 6585
		default: http->responseReason = "?"; break;
	}
}

//
// Copies key, sets valus
//

int HttpAddHeader(Http* http, int id, char* value )
{
	if( value == NULL )
	{
		ERROR("Cannot add empty header\n");
		return -1;
	}
	
	if( http->h_RespHeaders[ id ] != NULL )
	{
		FFree( http->h_RespHeaders[ id ] );
	}
	
	http->h_RespHeaders[ id ] = value;
	
	return 0;
}


/*
int HttpAddHeader( Http* http, const char* key, char* value )
{
	if( key && value  )
	{
		DEBUG("ADDHTTPHEADER %s : %s\n", key, value );
		
		// Lowercase the key
		int len = strlen( key );
		char* bkey = FCalloc( (len + 1), sizeof( char ) );
		if( bkey == NULL ) 
		{
			FFree( value );
			return -1;
		}
		memcpy( bkey, key, len );
		
		//int i = 0;
		//for( ; i < len; i++ )
		//{
		//	bkey[i] = HttpAlphaToLow( key[i] );
		//}
		
		// If this fails!
		if( HashmapPut( http->headers, bkey, value ) == FALSE )
		{
			ERROR("Cannot push data into hashmap %s\n", value );
			FFree( bkey ); 
			FFree( value );
			return -2;
		}
		else
		{
 			
		}
	}else if( value != NULL )
	{
		FFree( value );
	}
	return 0;
}*/



//
// Sets char *data on http structure (no copy, reference!)
//

void HttpSetContent( Http* http, char* data, unsigned int length )
{
	http->content = data;
	http->sizeOfContent = length;
	HttpAddHeader( http, HTTP_HEADER_CONTENT_LENGTH, Httpsprintf( "%d", http->sizeOfContent ) );
}

//
// Adds text content to http (real copy, no reference!)
//

void HttpAddTextContent( Http* http, char* content )
{
	http->sizeOfContent = strlen( content )+1;
	http->content = StringDuplicateN( content, http->sizeOfContent );
	http->sizeOfContent--;
	//http->sizeOfContent = strlen( content );
	HttpAddHeader( http, HTTP_HEADER_CONTENT_LENGTH, Httpsprintf( "%d", http->sizeOfContent ) );
}

//
//
//

#define HTTP_MAX_ELEMENTS 512

char * HttpBuild( Http* http )
{
	char *strings[ HTTP_MAX_ELEMENTS ];
	int stringsSize[ HTTP_MAX_ELEMENTS ];
	int stringPos = 0;

	// TODO: This is a nasty hack and should be fixed!
	HttpAddHeader( http, HTTP_HEADER_CONTROL_ALLOW_ORIGIN, StringDuplicateN( "*", 1 ) ); // TODO: FIX ME!!
	
	char *tmpdat = FCalloc( 512, sizeof( char ) );
	sprintf( tmpdat , "HTTP/%u.%u %u %s\r\n", http->versionMajor, http->versionMinor, http->responseCode, http->responseReason );
	strings[ stringPos++ ] = tmpdat;

	// Add all the custom headers
	unsigned int iterator = 0;
	int i = 0;
	
	for( i = 0 ; i < HTTP_HEADER_END ; i++ )
	{
		if( http->h_RespHeaders[ i ] != NULL )
		{
			char *tmp = FCalloc( 512, sizeof( char ) );
			if( tmp != NULL )
			{
				sprintf( tmp, "%s: %s\r\n", HEADERS[ i ], http->h_RespHeaders[ i ] );
				strings[ stringPos++ ] = tmp;
				//INFO("ADDDDDDDDDDDD %s   AND FREE %s\n", tmp, http->h_RespHeaders[ i ] );
				
				FFree( http->h_RespHeaders[ i ] );
				http->h_RespHeaders[ i ] = NULL;
			}
			else
			{
				ERROR("respheader = NULL\n");
				FFree( tmp );
			}
		}
	}

	strings[ stringPos++ ] = StringDuplicateN( "\r\n", 2 );

	// Find the total size of the response
	unsigned int size = http->sizeOfContent ? http->sizeOfContent : 0 ;
	
	for( i = 0 ; i < stringPos; i++ )
	{
		stringsSize[ i ] = strlen( strings[ i ] );
		size += stringsSize[ i ];
	}


	// Concat all the strings into one mega reply!!
	char* response = FCalloc( (size + 1), sizeof( char ) );
	char* ptr = response;
	//DEBUG("ALLOCSIZE %d\n", size );
	
	for( i = 0; i < stringPos; i++ )
	{
		memcpy( ptr, strings[ i ], stringsSize[ i ] );
		ptr += stringsSize[ i ];
		FFree( strings[ i ] );
	}

	if( http->sizeOfContent )
	{
		memcpy( response + ( size - http->sizeOfContent ), http->content, http->sizeOfContent );
	}
	
	//DEBUG("RESPONSE %s <<<\n", response );

	// Old response is gone
	if( http->response ) FFree( http->response );
		
	// Store the response pointer, so that we can free it later
	http->response = response;
	http->responseLength = size;

	return response;
}

// ---------------------------------------------------------------------------------------------------------------------
//
// Shorthands 
//
//

void HttpWriteAndFree( Http* http, Socket *sock )
{
	if( http == NULL )
	{
		ERROR("Http call was empty\n");
		return;
	}
	
	if( sock == NULL )
	{
		ERROR("[HttpWriteAndFree] HTTP WRITE sock is null\n");
		HttpFree( http );
		return;
	}
	
	DEBUG("HTTP AND FREE\n");
	
	//if( http->h_Socket->s_WSock == NULL )
	{
		char *res = HttpBuild( http );
		if( res != NULL )
		{
			// Write to the socket!
			SocketWrite( sock, http->response, http->responseLength );
		}
		else
		{
			HttpFree( http );
			return;
		}
	}
	
	HttpFree( http );
	
	INFO("HTTP FREE END\n");
}

//
// write, but do not free data
//

void HttpWrite( Http* http, Socket *sock )
{
	if( http == NULL )
	{
		return;
	}
	
	if( sock == NULL )
	{
		ERROR("[HttpWrite] HTTP WRITE sock is null\n");
		return;
	}
	
	//if( http->h_Socket->s_WSock == NULL )
	{
		HttpBuild( http );
		int left = http->responseLength;
		
		SocketWrite( sock, http->response, http->responseLength );
	}
}

// ---------------------------------------------------------------------------------------------------------------------
//
// Testing 
//
//

void HttpAssertNotNullPtr( void* val, const char* field )
{
	if( val == NULL )
	{
		printf( "Failed: Field \"%s\" is NULL, but shouldn't be.\n", field );
	}
}

//
//
//

void HttpAssertNullPtr( void* val, const char* field )
{
	if( val != NULL )
	{
		printf( "Failed: Field \"%s\" is not NULL. Is 0x%.8X.\n", field, *( unsigned int *)val );
	}
}

//
//
//

void HttpAssertIntValue( int value, int expected, const char* field )
{
	if( value != expected )
	{
		printf( "Failed: Field \"%s\" is not 0x%.8X. Is %.8X.\n", field, expected, value );
	}
}

//
//
//

void HttpAssertUnsignedIntValue( unsigned int value, unsigned int expected, const char* field )
{
	if( value != expected )
	{
		printf( "Failed: Field \"%s\" is not 0x%.8X. Is %.8X.\n", field, expected, value );
	}
}

//
//
//

void HttpAssertStr( char* value, const char* expected, const char* field )
{
	if( !value )
		printf( "Failed: Field \"%s\" is NULL, not \"%s\".\n", field, expected );
	else if( strcmp( value, expected ) != 0 )
		printf( "Failed: Field \"%s\" is not \"%s\". Is \"%s\".\n", field, expected, value );
}

//
//
//

void HttpTest()
{
	/*
	printf( "Begin test ----\n" );
	Http_t* h;
	h = HttpNew();

	HttpAssertNotNullPtr( h->headers, "headers" );

	HttpAssertIntValue( h->versionMajor, 1, "versionMajor" );
	HttpAssertIntValue( h->versionMinor, 1, "versionMinor" );

	HttpAssertNullPtr( h->method        , "method" );
	HttpAssertNullPtr( h->path          , "path" );
	HttpAssertNullPtr( h->query         , "query" );
	HttpAssertNullPtr( h->fragment      , "fragment" );
	HttpAssertNullPtr( h->version       , "version" );
	HttpAssertNullPtr( h->content       , "content" );
	HttpAssertNullPtr( h->queryMap      , "queryMap" );
	HttpAssertNullPtr( h->responseReason, "responseReason" );
	HttpAssertNullPtr( h->response      , "response" );

	HttpAssertUnsignedIntValue( h->errorCode     , 0, "errorCode" );
	HttpAssertUnsignedIntValue( h->errorLine     , 0, "errorLine" );
	HttpAssertUnsignedIntValue( h->sizeOfContent , 0, "sizeOfContent" );
	HttpAssertUnsignedIntValue( h->responseCode  , 0, "responseCode" );
	HttpAssertUnsignedIntValue( h->responseLength, 0, "responseLength" );
	HttpFree( h );

	typedef struct Test{
		const char* raw;
		const char* method;
		int major;
		int minor;
		char headers[10][2][2048];
		const char* version;
		const char* path;
		void* query;
		void* fragment;
		void* content;
		void* queryMap;
	} Test_t;

	const struct Test simpleGet = 
	{
		.raw =
			"GET / HTTP/1.1\r\n"
			"User-Agent: curl/7.18.0 (i486-pc-linux-gnu) libcurl/7.18.0 OpenSSL/0.9.8g zlib/1.2.3.3 libidn/1.1\r\n"
			"Host: 0.0.0.0=5000\r\n"
			"Accept: *"/"*\r\n"
			"\r\n",
		.major = 1,
		.minor = 1,
		.headers = 
		{
			{ "user-agent", "curl/7.18.0 (i486-pc-linux-gnu) libcurl/7.18.0 OpenSSL/0.9.8g zlib/1.2.3.3 libidn/1.1" },
			{ "host", "0.0.0.0=5000" },
			{ "accept", "*"/"*" }
		},
		.method = "GET",
		.version = "HTTP/1.1",
		.path = "/",
		.query = NULL,
		.fragment = NULL,
		.content = NULL,
		.queryMap = NULL,

	};

	Test_t* theTest = &simpleGet;

	h = HttpParseRequest( theTest->raw, strlen( theTest->raw ) );

	// Test fields
	HttpAssertStr( h->method , theTest->method    , "method" );
	HttpAssertStr( h->version, theTest->version   , "version" );
	HttpAssertStr( h->path   , theTest->path      , "path" );
	HttpAssertUnsignedIntValue( h->errorCode   , 0, "errorCode" );
	HttpAssertNullPtr( h->query                   , "query" );
	HttpAssertNullPtr( h->fragment                , "fragment" );
	HttpAssertNullPtr( h->content                 , "content" );
	HttpAssertNullPtr( h->queryMap                , "queryMap" );

	// Test headers
	for( unsigned int i = 0; i < 10; i++ )
	{
		if( simpleGet.headers[i][0][0] )
		{
			char* e = HttpGetHeader( h, (char*)simpleGet.headers[i][0], 0 );
			if( !e )
				printf( "Failed: Didn't find header \"%s\"\n", simpleGet.headers[i][0] );
			else
				HttpAssertStr( e, simpleGet.headers[i][1], simpleGet.headers[i][0] );
		}
	}

	HttpFree( h );
	printf( "End test ------\n" );
	*/
	return;
}

//
//
//

HttpFile *HttpFileNew( char *filename, int fnamesize, char *data, QUAD size )
{
	if( size <= 0 )
	{
		ERROR("Cannot upload empty file\n");
		return NULL;
	}
	
	char *locdata = FCalloc( size, sizeof( char ) );
	if( locdata == NULL )
	{
		ERROR("Cannot allocate memory for HTTP file data\n");
		return NULL;
	}
	
	HttpFile *file = FCalloc( 1, sizeof( HttpFile ) );
	if( file == NULL )
	{
		ERROR("Cannot allocate memory for HTTP file\n");
		free( locdata );
		return NULL;
	}
	
	memcpy( locdata, data, size );
	file->hf_Data = locdata;
	strncpy( file->hf_FileName, filename, fnamesize );
	file->hf_FileSize = size;
	
	INFO("New file created %s size %lld\n", file->hf_FileName, file->hf_FileSize );
	
	return file;
}

//
// remove file from memory
//

void HttpFileDelete( HttpFile *f )
{
	if( f != NULL )
	{
		free( f->hf_Data );
		
		free( f );
	}
}

//
//
//

HashmapElement* HttpGetPOSTParameter( Http *request,  char* param)
{
	return HashmapGet( request->parsedPostContent, param );
}

