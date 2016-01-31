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

// Window isn't loaded
window.frameInitialized = false;
window.loaded = false;
window.applicationStarted = false;
var __timeout = 90;

if ( this.apijsHasExecuted )
	throw new Error( 'api.js has already run, aborting' );

this.apijsHasExecuted = true;

// Create application object with standard functions ---------------------------

var Application = 
{
	activated: false,
	callbacks: [],
	permanentCallbacks: [],
	windows: [],
	messageQueue: [],
	receiveMessage: function( packet )
	{
		if( !packet.type ) return;
		switch( packet.type )
		{
			case 'callback':
				if( packet.windowId && Application.windows && Application.windows[packet.windowId] )
				{
					if( packet.command == 'viewresponse' )
					{
						Application.windows[packet.windowId].ready = packet.data == 'ok' ? true : false;
					}
					else
					{
						Application.windows[packet.windowId].sendMessage( packet );
					}
				}
				else if( this.view && this.view.sendMessage )
				{
					this.view.sendMessage( packet );
				}
				// Handle screens
				else if( packet.screenId && Application.screens && Application.screens[packet.screenId] )
				{
					if( packet.command == 'screenresponse' )
					{
						Application.windows[packet.screenId].ready = packet.data == 'ok' ? true : false;
					}
					else
					{
						Application.screens[packet.windowId].sendMessage( packet );
					}
				}
				else if( this.screen && this.screen.sendMessage )
				{
					this.screen.sendMessage( packet );
				}
				// BEWARE! DRAGONS!
				// This is probably the final destination (probably won't happen)
				else
				{
					var f = extractCallback( packet.callback );
					if( f )
					{
						f();
					}
					// Should never happen
					else
					{
						console.log( 'Untrappable callback lost in space' );
					}
				}
				break;
			// Recall for later
			default:
				this.messageQueue.push( packet );
				break;
		}
	},
	// Send quit up in hierarchy
	quit: function( skipSendMessage )
	{
		if( this.hasQuit )
			return;
		this.hasQuit = true;
		
		if( Application.onQuit )
			Application.onQuit();
		
		// Close all dormant doors
		if( DormantMaster.doors )
		{
			for( var a in DormantMaster.doors )
				DormantMaster.delAppDoor( DormantMaster.doors[a] );
		}
		
		// Flush dormant events
		var n = Application.applicationId.split( '-' )[0]; // TODO: app must have applicationName
		DormantMaster.delApplicationEvents( n );
		
		// Close all windows
		if( Application.windows )
		{
			for( var a in Application.windows )
			{
				Application.windows[a].close();
			}
		}
		
		if( Application.screens )
		{
			for( var a in Application.screens )
			{
				Application.screens[a].close();
			}
		}
		
		if( !skipSendMessage )
		{
			Application.sendMessage( {
				type:          'system',
				command:       'quit',
				force:         'true'
			} );
		}
	}
}

// Callbacks -------------------------------------------------------------------

// Generate a unique id in a select array buffer

function generateUniqueId( arrayBuffer, postfix )
{
	if( !postfix ) postfix = '';
	var uid = false;
	do
	{
		uid = ( Math.random() * 999 ) + '' + ( Math.random() * 999 ) + '' + ( ( new Date() ).getTime() );
	}
	while( typeof( arrayBuffer[uid + postfix ] ) != 'undefined' );
	return uid + postfix;
}

// Extract a callback element and return it

function extractCallback( id )
{
	var f = false;
	var out = [];
	for( var a in Application.callbacks )
	{
		if( a == id )
		{
			f = Application.callbacks[a];
		}
		else out[a] = Application.callbacks[a];
	}
	Application.callbacks = out;
	for( var a in Application.permanentCallbacks )
	{
		if( a == id )
		{
			f = Application.permanentCallbacks[a];
			break;
		}
	}
	return f;
}

// Add callback ( will return false if something already exists )
function addCallback( cb, forceId )
{
	if( forceId )
	{
		if( typeof( Application.callbacks[forceId] ) != 'undefined' )
			return false;
		Application.callbacks[forceId] = cb;
		return forceId;
	}
	else
	{
		var id = generateUniqueId( Application.callbacks );
		if( !id ) return false;
		Application.callbacks[id] = cb;
		return id;
	}
}

// Add a callback that will stay on the application
function addPermanentCallback( cb )
{
	var id = generateUniqueId( Application.permanentCallbacks, '_permanent' );
	if( !id ) return false;
	Application.permanentCallbacks[id] = cb;
	return id;
}

// Get the url variables passed to application ---------------------------------

function getUrlVar( vari )
{
	var url = document.location.href.split( '?' );
	if( url.length > 1 )
	{
		url = url[1];
		var vars = url.split( '&' );
		for( v = 0; v < vars.length; v++ )
		{
			var va = vars[v].split( '=' );
			if( va[0] == vari ) return va[1];
		}
	}
}

// Receive messages from parent environment ------------------------------------

function receiveEvent( event, queued )
{
	// TODO: Do security stuff...
	//
	var dataPacket = JSON.parse( event.data );
	
	if ( !dataPacket.command ) 
	{	
		Application.receiveMessage( dataPacket );
		done();
		return;
	}
	
	// Queue until ready
	if( dataPacket.command != 'register' && dataPacket.command != 'initappframe' && !queued && !window.Application.applicationId )
	{
		function o()
		{
			// We need to wait!
			if( !window.loaded )
			{
				// We just need some simple stuff!
				if( dataPacket.command == 'setbodycontent' )
				{
					initApplicationFrame( dataPacket, event.origin );
				}
				return setTimeout( o, __timeout );
			}
			return receiveEvent( event, true );
		}
		o();
		return;
	}
	
	switch( dataPacket.command )
	{
		// On opening window
		case 'viewresponse':
			// Can't create window? Quit
			// TODO: More sane error handling
			if( dataPacket.data == 'fail' )
			{
				Application.quit();
			}
			break;
		case 'screenresponse':
			// Can't create screen? Quit
			if( dataPacket.data == 'fail' )
			{
				Application.quit();
			}
			break;
		// TODO: Never gets here?
		case 'notify':
			if( dataPacket.method )
			{
				switch( dataPacket.method )
				{
					case 'refreshtheme':
						console.log( 'Theme agogo!' );
						console.log( dataPacket );
						break;
					case 'closewindow':
					case 'closeview':
						// Close an exact window
						if( dataPacket.windowId && Application.windows && Application.windows[dataPacket.windowId] )
						{
							var w = Application.windows[dataPacket.windowId];
							if( w.onClose ) w.onClose();
							w.close();
						}
						// Ah, sub window! Channel to all sub windows then (unknown id?)
						else if( dataPacket.windowId )
						{
							for( var a in Application.windows )
							{
								var w = Application.windows[a];
								w.sendMessage( dataPacket );
							}
						}
						// Close all windows
						// FIXME: Might not be what we want
						else if( Application.windows.length )
						{
							for( var a in Application.windows )
							{
								var w = Application.windows[a];
								if( w.onClose ) w.onClose();
								w.close();
							}
						}
						// We have no registered window, notify with quit
						else
						{
							Application.sendMessage( {
								type:          'system',
								command:       'kill'
							} );
						}
						break;
					// Activate it
					case 'activateview':
						Application.activated = true;
						document.body.className = document.body.className.split( ' activated' ).join ( '' ) + ' activated';
						break;
					// Deactivate it
					case 'deactivateview':
						Application.activated = false;
						document.body.className = document.body.className.split( ' activated' ).join ( '' );
						break;
					default:
						break;
				}
			}
			break;
		case 'initappframe':
			// Don't reinit.. that's not smart, so break
			if( window.Application.applicationId ) break;
			initApplicationFrame( dataPacket, event.origin );
			break;
		// Is often called on an already opened image
		case 'setbodycontent':
			
			document.body.className = 'Loading';
			document.body.innerHTML = dataPacket.data;
			
			// Attach scripts to dom
			if( ActivateScripts )
			{
				ActivateScripts( dataPacket.data );
			}
			else console.log( 'Could not activate scripts' );
			
			// We need to set these if possible
			Application.authId        = dataPacket.authId;
			Application.filePath      = dataPacket.filePath;
			Application.applicationId = dataPacket.applicationId;
			Application.userId        = dataPacket.userId;
			
			initApplicationFrame( dataPacket, event.origin );
			
			// Just call back
			if( dataPacket.callback )
			{
				parent.postMessage( JSON.stringify( {
					type:          'callback',
					callback:      dataPacket.callback,
					applicationId: dataPacket.applicationId,
					theme:         dataPacket.theme,
					authId:        dataPacket.authId,
					userId:        dataPacket.userId
				} ), event.origin );
			}
			break;
		case 'setcontentbyid':
			var el = document.getElementById( dataPacket.elementId );
			if( el ) el.innerHTML = dataPacket.data;
			
			// Just call back
			if( dataPacket.callback )
			{
				parent.postMessage( JSON.stringify( {
					type:          'callback',
					callback:      dataPacket.callback,
					applicationId: dataPacket.applicationId,
					theme:         dataPacket.theme,
					authId:        dataPacket.authId,
					userId:        dataPacket.userId
				} ), event.origin );
			}
			if( el ) RunScripts( dataPacket.data );
			break;
		case 'getattributebyid':
			// Some days, receive the attribute value here.. and run callback
			break;
		// Set a property by id
		case 'setattributebyid':
			var el = document.getElementById( dataPacket.elementId );
			if( el ) 
			{
				el.setAttribute( dataPacket.attribute, dataPacket.data );
			}
			// Just call back
			if( dataPacket.callback )
			{
				parent.postMessage( JSON.stringify( {
					type:          'callback',
					callback:      dataPacket.callback,
					applicationId: dataPacket.applicationId,
					theme:         dataPacket.theme,
					authId:        dataPacket.authId,
					userId:        dataPacket.userId
				} ), event.origin );
			}
			break;
		case 'register':
			window.origin = event.origin;
			// A function to send a message
			Application.domain        = dataPacket.domain;
			Application.authId        = dataPacket.authId;
			Application.filePath      = dataPacket.filePath;
			Application.applicationId = dataPacket.applicationId;
			Application.userId        = dataPacket.userId;
			Application.sendMessage   = setupMessageFunction( dataPacket, window.origin );
			// Initialize app frame
			initApplicationFrame( dataPacket, event.origin );
			break;
		// Here comes the shell callback
		case 'shell':
			if( dataPacket.windowId && Application.windows && Application.windows[dataPacket.windowId] )
			{
				Application.windows[dataPacket.windowId].sendMessage( dataPacket );
			}
			else
			{
				// Shell object
				if( dataPacket.shellId )
				{
					var f = extractCallback( dataPacket.shellId );
					if( f && f.onBeforeReady ) f.onBeforeReady( dataPacket );
					if( f && f.onReady ) f.onReady( dataPacket );
				}
				// Normal callback
				else if( dataPacket.callbackId )
				{
					var f = extractCallback( dataPacket.callbackId );
					if( f )
					{
						f( dataPacket );
					}
				}
			}
			break;
		// A file loaded
		case 'fileload':
			if( dataPacket.windowId && Application.windows && Application.windows[dataPacket.windowId] )
			{
				Application.windows[dataPacket.windowId].sendMessage( dataPacket );
			}
			// Pass to screen
			else if( dataPacket.screenId && Application.screens && Application.screens[dataPacket.screenId] )
			{
				Application.screens[dataPacket.screenId].sendMessage( dataPacket );
			}
			else
			{
				var out = [];
				var f = false;
				var f = extractCallback( dataPacket.fileId );
				if( f )
				{
					f.data = dataPacket.data;
					if( dataPacket.returnCode )
						f.returnCode = dataPacket.returnCode;
					// For File objects
					if( f.onLoad )
					{
						if( f.replacements )
						{
							for( var a in f.replacements )
							{
								f.data = f.data.split( '{' + a + '}' ).join ( f.replacements[a] );
							}
						}
						// For jsx files and others
						if( Application.appPath )
						{
							var base = '/system.library/file/read?authid=' + ( Application.authId ? Application.authId : '' ) + '&mode=rb&path=';
							f.data = f.data.split( /progdir\:/i ).join ( base + Application.appPath  );
							f.data = f.data.split( /libs\:/i ).join ( Application.domain + '/webclient/' );
							f.data = f.data.split( /system\:/i ).join ( Application.domain + '/webclient/' );
						}
						f.onLoad( f.data );
					}
					// For Module objects
					else if ( f.onExecuted )
					{
						f.onExecuted( dataPacket.returnCode, dataPacket.data );
					}
					else
					{
						console.log( 'No callback?' );
					}
				}
				// TODO: This should be removed, it's a double right? Like the first if. . . Goes further down to a window
				else if( dataPacket.windowId && Application.windows && Application.windows[dataPacket.windowId] )
				{
					Application.windows[dataPacket.windowId].sendMessage( dataPacket );
				}
				// Goes further down stream
				else
				{
					Application.receiveMessage( dataPacket );
				}
			}
			break;
		// Filepost response
		case 'filepost':
			if( dataPacket.windowId && Application.windows && Application.windows[dataPacket.windowId] )
			{
				Application.windows[dataPacket.windowId].sendMessage( dataPacket );
			}
			// Pass to screen
			else if( dataPacket.screenId && Application.screens && Application.screens[dataPacket.screenId] )
			{
				Application.screens[dataPacket.screenId].sendMessage( dataPacket );
			}
			else
			{
				var f = extractCallback( dataPacket.fileId );
				if( f )
				{
					if( f.onPost ) 
					{
						f.onPost();
					}
					else
					{
						console.log( 'There was no onpost here!' );
					}
				}
				// Goes further down stream to self
				else
				{
					Application.receiveMessage( dataPacket );
				}
			}
			break;
		// Filesave response
		case 'filesave':
			if( dataPacket.windowId && Application.windows && Application.windows[dataPacket.windowId] )
			{
				Application.windows[dataPacket.windowId].sendMessage( dataPacket );
			}
			// Pass to screen
			else if( dataPacket.screenId && Application.screens && Application.screens[dataPacket.screenId] )
			{
				Application.screens[dataPacket.screenId].sendMessage( dataPacket );
			}
			else
			{
				var f = extractCallback( dataPacket.fileId );
				if( f )
				{
					if( f.onSave ) 
					{
						f.onSave();
					}
					else
					{
						console.log( 'There was no onsave here!' );
					}
				}
				// Goes further down stream to self
				else
				{
					Application.receiveMessage( dataPacket );
				}
			}
			break;
		// Messages for dormant - getting data from this app
		case 'dormantmaster':
			if( dataPacket.method )
			{
				if( dataPacket.method == 'getdirectory' )
				{
					// Execute and give callback
					if( DormantMaster.doors[ dataPacket.doorId ] )
					{
						var items = DormantMaster.doors[ dataPacket.doorId ].getFolder( dataPacket.path );
						Application.sendMessage( {
							type: 'dormantmaster',
							method: 'callback',
							doorId: dataPacket.doorId,
							callbackId: dataPacket.callbackId,
							data: items
						} );
					}
				}
				// On success, we will update the title to the actual name
				else if( dataPacket.method == 'updatetitle' )
				{
					for( var a in DormantMaster.doors )
					{
						if( DormantMaster.doors[a].title == dataPacket.title )
						{
							DormantMaster.doors[a].title = dataPacket.realtitle;
							break;
						}
					}
				}
				else if( dataPacket.method == 'execute' )
				{
					// Execute and give callback
					if( DormantMaster.doors[ dataPacket.doorId ] )
					{
						var data = DormantMaster.doors[ dataPacket.doorId ].execute( dataPacket.dormantCommand, dataPacket.dormantArgs );
						Application.sendMessage( {
							type: 'dormantmaster',
							method: 'callback',
							doorId: dataPacket.doorId,
							callbackId: dataPacket.callbackId,
							data: data
						} );
					}
				}
				else if( dataPacket.method == 'callback' )
				{
					// Just pass it
					if( dataPacket.windowId && Application.windows && Application.windows[dataPacket.windowId] )
					{
						Application.windows[dataPacket.windowId].sendMessage( dataPacket );
					}
					else
					{
						var f = extractCallback( dataPacket.callbackId );
						if( f )
						{
							f( dataPacket.data );
						}
					}
				}
			}
			break;
		// Messages for doors
		case 'door':
			console.log( 'api.js - we got a door message:' );
			console.log( dataPacket );
			break;
		case 'applicationstorage':
			console.log( 'api.js - applicationstorage event', msg );
			if ( msg.callbackId ) {
				var callback = extractCallback( msg.callbackId );
				callback( msg.data );
			}
			break;
		// Unknown command
		case 'libraryresponse':
		
			if( dataPacket.windowId && Application.windows && Application.windows[dataPacket.windowId] )
			{
				Application.windows[dataPacket.windowId].sendMessage( dataPacket );
			}
			else
			{
				var f = extractCallback( dataPacket.callbackId );
				console.log( 'Library response: (' + document.title + ')' );
				console.log( dataPacket );
				console.log( f );
				if( f && f.onExecuted )
				{
					console.log( 'We even have "onexecuted.."' );
					f.onExecuted( dataPacket.data );
				}
				console.log('library response done');
			}
			break;
		// Response from the file dialog
		case 'filedialog':
			if( dataPacket.windowId && Application.windows && Application.windows[dataPacket.windowId] )
			{
				Application.windows[dataPacket.windowId].sendMessage( dataPacket );
				console.log( 'Sending callback further down! (' + document.title + ')' );
				console.log( dataPacket );
			}
			// Handle the callback
			if( dataPacket.callbackId && typeof( Application.callbacks[dataPacket.callbackId] ) != 'undefined' )
			{
				var f = extractCallback( dataPacket.callbackId );
				if( f )
				{
					f( dataPacket.data );
					console.log( 'We executed the filedialog callback!' );
				}
			}
			break;
		// Received quit signal!
		case 'quit':
			Application.quit(); // Tell to skip signaling back
			break;
		default:
			Application.receiveMessage( dataPacket );
			break;
	}
	done();
	
	function done() 
	{
		// Run callbacks and clean up
		if( dataPacket.callback )
		{
			// Ok, we will try to execute the callback we found here!
			if( typeof(Application.callbacks) != 'undefined' && typeof(Application.callbacks[dataPacket.callback]) != 'undefined' )
			{
				Application.callbacks[dataPacket.callback]( dataPacket );
				// Remove callback function from callback buffer
				var out = [];
				for( var a in Application.callbacks )
					if( a != dataPacket.callback )
						out[a] = Application.callbacks[a];
				Application.callbacks = out;
				return;
			}
			// Aha, we have a window to send to (see if it's at this level)
			else if( dataPacket.windowId )
			{
				if( Application.windows && typeof( Application.windows[dataPacket.windowId] ) != 'undefined' )
				{
					return Application.windows[dataPacket.windowId].sendMessage( dataPacket );
				}
			}
		}
		// Clean up callbacks
		else
		{
			var n = [];
			for( var b in Application.callbacks )
			{
				if( dataPacket.callbackId == b )
				{
					console.log( 'Removed executed callback anchor (' + document.title + ')' );
				}
				else
				{
					n[b] = Application.callbacks[b];
				}
			}
			Application.callbacks = n;
		}
	}
}

// Web socket API --------------------------------------------------------------

// TODO: Complete this!
function FriendWebSocket( config )
{
	if( typeof( Application.websockets ) == 'undefined' )
		Application.websockets = [];
	// Add this websocket (passive at first)
	this.active = false;
	
	// Find a unique ID for the websocket
	var id = ( Math.random() * 999 ) + ( Math.random() * 999 ) + ( new Date().getTime() );
	var found = false;
	do
	{
		found = false;
		if( Application.websockets.length )
		{
			for( var a in Application.websockets ) 
			{
				if( a == id )
				{
					id = ( Math.random() * 999 ) + ( Math.random() * 999 ) + ( new Date().getTime() );
					found = true;
					break;
				}
			}
		}
	}
	while( found );
	Application.websockets[id] = this;
	
	// Connect to server
	// TODO: Add callback on which to communicate
	this.connect = function( url, protocol )
	{
		this.active = true;
		Application.sendMessage( {
			type: 'websocket',
			method: 'connect',
			data: { url: url, protocol: protocol }
		} );
	}
}


// Open a new view -------------------------------------------------------------

function View( flags )
{
	var windowId = 'window_' + ( new Date() ).getTime() + '.' + Math.random();
	
	// Proxy screens are virtual :)
	if( flags.screen )
		flags.screen = flags.screen.getScreenId();
	
	var msg = {
		type:    'view',
		data:    flags,
		windowId: windowId
	}
	this.getWindowId = function()
	{
		return windowId;
	}
	// Set flags
	this.setFlags = function( flags )
	{
		Application.sendMessage( {
			type:    'view',
			method:  'setFlags',
			windowId: windowId,
			data:    flags
		} );
	}
	// Set single flag
	this.setFlag = function( flag, value )
	{
		Application.sendMessage( {
			type:    'view',
			method:  'setFlag',
			windowId: windowId,
			data:    { flag: flag, value: value }
		} );
	}
	// Set window content
	this.setContent = function( data, callback )
	{
		// Add callback
		var cid = false;
		if( callback )
			cid = addCallback( callback );
		Application.sendMessage( {
			type:     'view',
			method:   'setContent',
			windowId: windowId,
			filePath: Application.filePath,
			callback: cid,
			data:     data
		} );
	}
	// Sets a property by id
	this.setAttributeById = function( id, property, value, callback )
	{
		// Add callback
		var cid = false;
		if( callback ) cid = addCallback( callback );
		Application.sendMessage( {
			type:      'view',
			method:    'setAttributeById',
			windowId:  windowId,
			filePath:  Application.filePath,
			elementId: id,
			callback:  cid,
			attribute: property,
			data:      value
		} );
	}
	this.getAttributeById = function( id, property, callback )
	{
		var cid = false;
		if( callback ) cid = addCallback( callback );
		Application.sendMessage( {
			type:      'view',
			method:    'getAttributeById', 
			windowId:  windowId,
			filePath:  Application.filePath,
			elementId: id,
			callback:  cid,
			attribute: property
		} );
	}
	this.setContentById = function( id, data, callback )
	{
		// Add callback
		var cid = false;
		if( callback ) cid = addCallback( callback );
		Application.sendMessage( {
			type:      'view',
			method:    'setContentById',
			windowId:  windowId,
			filePath:  Application.filePath,
			elementId: id,
			callback:  cid,
			data:      data
		} );
	}
	// Set rich window content
	this.setRichContent = function( data )
	{
		Application.sendMessage( {
			type:    'view',
			method:  'setRichContent',
			filePath: Application.filePath,
			windowId: windowId,
			data:     data
		} );
	}
	this.setRichContentUrl = function( url )
	{
		Application.sendMessage( {
			type:     'view',
			method:   'setRichContentUrl',
			base:     Application.domain + '/webclient/',
			domain:   'http://' + document.location.href.split( '//' )[1].split( '/' )[0],
			filePath: Application.filePath,
			windowId: windowId,
			url:      url
		} );
	}
	this.loadTemplate = function( url )
	{
		url = url.split( /progdir\:/i ).join( Application.appPath ? Application.appPath : Application.filePath );
		url = url.split( /libs\:/i ).join( Application.domain + '/webclient/' );
		url = getImageUrl( url );
		this.setRichContentUrl( url );
	}
	// Set subcontent on window
	// TODO: Remove this, we will use setContentById!!
	this.setSubContent = function( identifier, flag, data )
	{
		Application.sendMessage( {
			type:       'view',
			method:     'setSubContent',
			windowId:   windowId,
			filePath:   Application.filePath,
			flag:       flag,
			identifier: identifier,
			data:       data
		} );
	}
	// Get subcontent 
	this.getContentById = function( identifier, flag, callback )
	{
		Application.sendMessage( {
			type:       'view',
			method:     'getContentById',
			windowId:   windowId,
			identifier: identifier,
			flag:       flag
		} );
	}
	// Set an attribute on subcontent
	this.setSubContentAttribute = function( identifier, flag, attribute, value )
	{
		Application.sendMessage( {
			type:       'view',
			method:     'setSubContentAttribute',
			windowId:   windowId,
			identifier: identifier,
			flag:       flag,
			attribute:  attribute,
			value:      value
		} );
	}
	// Add an event on window sub element
	this.addEventByClass = function( classname, event, callback )
	{
		Application.sendMessage( {
			type:     'view',
			method:   'addEventByClass',
			windowId:  windowId,
			className: classname,
			event:     event,
			callback:  callback
		} );
	}
	this.focusOnElement = function( identifier, flag )
	{
		Application.sendMessage( {
			type:       'view',
			method:     'focusOnElement',
			windowId:   windowId,
			identifier: identifier,
			flag:       flag
		} );
	}
	this.activate = function()
	{
		for( var a in Application.windows )
		{
			if( Application.windows[a] != this )
				Application.windows[a].activated = false;
		}
		this.activated = true;
		Application.sendMessage( {
			type:     'view',
			method:   'activate',
			windowId: windowId
		} );
		// Add class
		document.body.className = document.body.className.split( ' activated' ).join ( '' ) + ' activated';
	}
	this.focus = function()
	{
		Application.sendMessage( {
			type:     'view',
			method:   'focus',
			windowId:  windowId
		} );
	}
	this.sendMessage = function( dataObject )
	{
		Application.sendMessage( {
			type:    'view',
			method:  'sendmessage',
			windowId: windowId,
			data:     dataObject
		} );
	}
	
	// Sets the menu item on view element
	this.setMenuItems = function( object )
	{
		// Recursive translator
		function applyi18n( object )
		{
			for( var a = 0; a < object.length; a++ )
			{
				object[a].name = i18n( object[a].name );
				if( object[a].items && typeof( object[a].items ) == 'array' )
					object[a].items = applyi18n( object[a].items );
			}
			return object;
		}
	
		// Execute translations
		object = applyi18n( object );
		
		Application.sendMessage( {
			type:     'view',
			method:   'setMenuItems',
			windowId: windowId,
			data:     object
		} );
	}
	
	// Closes the view
	this.close = function()
	{
		// Don't double close!
		if( this.closed ) return;
		this.closed = true;
		
		if ( this.onClose ) this.onClose();
		
		// Kill slot
		var w = [];
		var count = 0;
		for( var a in Application.windows )
		{
			if( a == windowId ) continue;
			else
			{
				w[a] = Application.windows[a];
				count++;
			}
		}
		Application.windows = w;
		
		// Tell the application to close!
		Application.sendMessage( {
			type:     'view',
			method:   'close',
			windowId: windowId
		} );
	}
	
	// Setup view object with master
	Application.sendMessage( msg );
	if( !Application.windows )
		Application.windows = {};
	Application.windows[ windowId ] = this;
	
	// Just activate this window
	this.activate();
}

// Make a new popupview --------------------------------------------------------
function PopupView( parentWindow, flags )
{
	var popupWindowId = 'popupwindow_' + ( new Date() ).getTime() + '.' + Math.random();
	var msg = {
		type:    'popupview',
		data:    flags,
		popupWindowId: popupWindowId
	}
}

// Screen object abstraction ---------------------------------------------------
function Screen( flags )
{
	var screenId = 'screen_' + ( new Date() ).getTime() + '.' + Math.random();
	var msg = {
		type:    'screen',
		data:    flags,
		screenId: screenId
	}
	this.getScreenId = function()
	{
		return screenId;
	}
	
	// Set window content
	this.setContent = function( data, callback )
	{
		// Add callback
		var cid = false;
		if( callback ) cid = addCallback( callback );
		Application.sendMessage( {
			type:     'screen',
			method:   'setContent',
			screenId: screenId,
			filePath: Application.filePath,
			callback: cid,
			data:     data
		} );
	}
	
	// Sets the menu item on view element
	this.setMenuItems = function( object )
	{
		// Recursive translator
		function applyi18n( object )
		{
			for( var a = 0; a < object.length; a++ )
			{
				object[a].name = i18n( object[a].name );
				if( object[a].items && typeof( object[a].items ) == 'array' )
					object[a].items = applyi18n( object[a].items );
			}
			return object;
		}
		
		// Execute translations
		object = applyi18n( object );
		
		Application.sendMessage( {
			type:     'screen',
			method:   'setMenuItems',
			screenId: screenId,
			data:     object
		} );
	}
	
	// Closes the screen
	this.close = function()
	{
		// Don't double close!
		if( this.closed ) return;
		this.closed = true;
		if ( this.onClose ) this.onClose();
		
		// Kill slot
		var w = [];
		var count = 0;
		for( var a in Application.screens )
		{
			if( a == screenId ) continue;
			else
			{
				w[a] = Application.screens[a];
				count++;
			}
		}
		Application.screens = w;
		
		// Tell the application to close!
		Application.sendMessage( {
			type:     'screen',
			method:   'close',
			screenId: screenId
		} );
	}
	
	this.sendMessage = function( dataObject )
	{
		Application.sendMessage( {
			type:    'screen',
			method:  'sendmessage',
			screenId: screenId,
			data:     dataObject
		} );
	}
	
	// Setup view object with master
	Application.sendMessage( msg );
	if( !Application.screens )
		Application.screens = {};
	Application.screens[ screenId ] = this;
}

// Shell API -------------------------------------------------------------------

Shell = function()
{
	var cid = addCallback( this );
	
	var appObject = {
		applicationId: Application.applicationId,
		authId:        Application.authId
	};
	
	Application.sendMessage( {
		type:    'shell',
		args:    appObject,
		vars:    this.vars,
		shellId: cid
	} );
	
	this.onBeforeReady = function( msg )
	{
		if( msg.shellSession )
		{
			this.shellSession = msg.shellSession;
			this.number = msg.shellNumber;
		}
	}
	
	this.close = function()
	{
		if( !this.shellSession ) return;
		
		Application.sendMessage( {
			type: 'shell',
			command: 'close',
			shellSession: this.shellSession
		} );
	}
	
	// Adds an event
	this.addEvent = function( eventName, persistent, callback )
	{
		var allowedEvents = [
			'mount', 'unmount', 'openscreen', 'closescreen',
			'openview', 'closeview' /* More to come... */
		];
		
	}
	
	this.execute = function( commandLine, callback )
	{
		if( !this.shellSession ) return;
		var cb = false;
		if( callback ) cb = addCallback( callback );
		Application.sendMessage( {
			type: 'shell',
			command: 'execute',
			commandLine: commandLine,
			shellSession: this.shellSession,
			callbackId: cb
		} );
	}
	
	// Clear events (by name optionally)
	this.clearEvents = function( eventName )
	{
		if( !eventName ) this.events = [];
		else
		{
			var nlist = [];
			for( var a = 0; a < this.events.length; a++ )
			{
				if( this.events[a][0] != eventName )
					nlist.push( this.events[a] );
			}
			this.events = nlist;
		}
	}
}


// Audio API -------------------------------------------------------------------

// build a request and fire it off
// TODO: Make this global for the Doors space (use proxy!)
var __audioContext = false;

WebAudioLoader = function( filePath, callback ) 
{
	if( !__audioContext )
		__audioContext = new AudioContext();
		
	this.audioGraph =
	{
		context: __audioContext,                                                //this is the container for your entire audio graph
		bufferCache: null,                                                      //buffer needs to be re-initialized before every play, so we'll cache what we've loaded here
		playTime: 0,
		paused: false,
		//for chaching / retrieving the buffer
		getBufferCache: function()
		{
			return this.bufferCache;  
		},
		setBufferCache: function( _sound )
		{
			this.bufferCache = _sound;
		},
		//for setting the current instance of the buffer 
		setBuffer: function( _sound )
		{
			this.source.buffer = _sound;
		},
		setPlaybackRate: function( pitch )
		{
			this.pitch = pitch;
		},
		setRate: function( rate )
		{
			this.rate = rate;
		},
		//play it
		playSound: function()
		{
			if( this.started )
			{
				this.source.stop();                                             //call noteOff to stop any instance already playing before we play ours
				this.started = false;
			}
			this.source = this.context.createBufferSource();                    //init the source
			this.setBuffer( this.bufferCache );                                 //re-set the buffer
			this.source.playbackRate.value = this.pitch;                        //here's your playBackRate check
			this.source.connect( this.context.destination );                    //connect to the speakers 
			this.source.start();                                                //pass in 0 to play immediately
			this.started = Date.now();
			this.pausedPos = 0;
			this.playTime = this.context.currentTime;                           // offset
		},
		pause: function()
		{
			if( this.paused )
			{
				// New time
				if( this.started ) this.source.stop();
				this.started = Date.now() - this.pausedPos;
				this.paused = false;
				this.source = this.context.createBufferSource();                //init the source
				this.setBuffer( this.bufferCache );                             //re-set the buffer
				this.source.playbackRate.value = this.pitch;                    //here's your playBackRate check
				this.source.connect( this.context.destination );                //connect to the speakers 
				this.source.start( 0, this.pausedPos / 1000 );
				this.playTime = this.context.currentTime - ( this.pausedPos / 1000 )
			}
			else
			{
				this.paused = true;
				this.pausedPos = Date.now() - this.started;
				if( this.started )
				{
					this.started = 0;
					this.source.stop();
				}
			}
			return this.paused;
		},
		stop: function()
		{
			if( !this.started ) return;
			this.started = false;
			this.paused = false;
			this.source.stop();
		}
		
	}
	
	// Do we need this?
	this.audioGraph.source = this.audioGraph.context.createBufferSource();      //your buffer will sit here
	
	var t = this;
	
	// Do the loading
	(function()
	{
		var _request = new XMLHttpRequest(),
		_handleRequest = function(url)
		{
			_request.open( 'GET', url, true );
			_request.responseType = 'arraybuffer';
			_request.onload = function()
			{
				// Decode
				t.audioGraph.context.decodeAudioData( 
					_request.response,
					function( buf )
					{
						t._loadedBuffer = buf;
						t.audioGraph.setBuffer( buf );
						t.audioGraph.setBufferCache( buf );
						if( callback ) callback();
					},
					function()
					{
						// error;
					}
				);
			}
			_request.send();
		}
		_handleRequest( getImageUrl( filePath ) );
	}());//loader
};

var __audioLoaders = [];
var __maxAudioLoaders = 1;
var __currentAudioLoader = 0;

function AudioObject( sample )
{
	this.loaded = false;
	this.loadSample = function( path )
	{
		var t = this;
		this.loader = new WebAudioLoader( getImageUrl( path ), function(){ 
			t.loaded = true; 
			t.loader.audioGraph.setRate( 1 );
			t.loader.audioGraph.setPlaybackRate( 1 );
			if( t.onload )
				t.onload(); 
		} );
		this.path = path;
	}
	
	this.getContext = function()
	{
		return __audioContext;
	}
	
	this.setCurrentTime = function( time )
	{
		this.loader.audioGraph.source.currentTime = time;
	}
	
	this.getCurrentTime = function()
	{
		return this.loader.audioGraph.source.currentTime;
	}
	
	this.pause = function()
	{
		this.paused = this.loader.audioGraph.pause();
	}
	
	this.unload = function()
	{
		this.loader.audioGraph.source = null;
		this.loader.audioGraph = null;
		this.loader = null;
	}
	
	this.stop = function()
	{
		this.loader.audioGraph.stop();
		if( this.interval )
		{
			clearInterval( this.interval );
			this.interval = false;
		}
	}
	
	this.decode = function()
	{
		
	}
	
	this.playArgs = function( args )
	{
		if( !args ) return;
		if( args.pitch ) this.loader.audioGraph.setPlaybackRate( args.pitch );
		if( args.pitch ) this.loader.audioGraph.setRate( args.pitch );
		this.loader.audioGraph.playSound();
	}
	
	// Plays notes!
	this.play = function()
	{
		this.loader.audioGraph.playSound();
		
		if( this.interval ) clearInterval( this.interval );
		var t = this;
		this.interval = setInterval( function()
		{
			if( !t.loader.audioGraph.paused && t.getContext().currentTime - t.loader.audioGraph.playTime >= t.loader.audioGraph.source.buffer.duration )
			{
				if( t.onfinished )
				{
					t.onfinished();
				}
			}
			if( t.loader.audioGraph.started && t.onplaying && !t.loader.audioGraph.paused )
			{
				t.onplaying( ( t.getContext().currentTime - t.loader.audioGraph.playTime ) / t.loader.audioGraph.source.buffer.duration );
			}
		}, 100 );
	}
	
	if( sample )
	{
		this.loadSample( sample );
	}
}


// File object abstraction -----------------------------------------------------

function getImageUrl( path )
{
	// TODO: Determine from Doors!
	var u = '/system.library/file/read?authid=' + Application.authId + '&path=' + path + '&mode=rb';
	return u;
}

function File( path )
{
	this.path = path;
	var fid = addCallback( this );
	this.vars = {};
	var apath = Application.appPath ? Application.appPath : Application.filePath;
	
	this.load = function()
	{
		Application.sendMessage( {
			type:    'file',
			data:    { path: this.path },
			method:  'load',
			filePath: apath,
			vars:    this.vars,
			fileId:  fid
		} );
	}
	
	// Posts a file through file upload
	this.post = function( filename, content )
	{
		Application.sendMessage( {
			type:    'file',
			data:    { filename: filename, data: Base64.encode( content ) },
			method:  'post',
			fileId:  fid
		} );
	}
	
	this.save = function( filename, data )
	{
		Application.sendMessage( {
			type:    'file',
			data:    { path: filename, data: data },
			method:  'save',
			filePath: apath,
			vars:    this.vars,
			fileId:  fid
		} );
	}
	this.addVar = function( key, value )
	{
		this.vars[key] = value;
	}
}

// Module object abstraction ---------------------------------------------------

function Module( module )
{
	var fid = addCallback( this );
	this.vars = [];
	this.execute = function( method, args )
	{
		Application.sendMessage( {
			type:    'module',
			module:  module,
			method:  method,
			args:    args,
			vars:    this.vars,
			fileId:  fid
		} );
	}
	this.addVar = function( key, value )
	{
		this.vars[key] = value;
	}
}

// Abstract dormant ------------------------------------------------------------
// TODO: All these methods should trigger callbacks
DormantMaster = {
	doors: [],
	// Adds a doormant appdoor
	addAppDoor: function( dormantDoorObject )
	{
		var uniqueId = generateUniqueId( this.doors );
		this.doors[ uniqueId ] = dormantDoorObject;
		dormantDoorObject.uniqueId = uniqueId;
		Application.sendMessage( {
			type:     'dormantmaster',
			method:   'addAppDoor',
			title:    dormantDoorObject.title,
			doorId:  uniqueId
		} );
	},
	setupProxyDoor: function( info )
	{
		// Make sure we can get this folder
		info.Dormant = new Object();
		info.Dormant.getFolder = function( path, callback )
		{
			var cid = addCallback( callback );
			
			console.log( 'Api.js - proxydoor - asking for folders.' );
			
			Application.sendMessage( {
				type: 'dormantmaster',
				method: 'getFolder',
				callbackId: cid,
				path: path
			} );
		}
	},
	// Get a list of all doors
	getDoors: function( callback )
	{
		var t = this;
		var fid = addCallback( function( msg ){
			for( var a in msg )
				t.setupProxyDoor( msg[a] );
			if( callback )
				callback( msg );			
		} );
		Application.sendMessage( {
			type:     'dormantmaster',
			method:   'getDoors',
			callbackId: fid
		} );
		return false;
	},
	// Delete an appdoor
	delAppDoor: function( door )
	{
		if( !door.uniqueId ) return;
		Application.sendMessage( {
			type:     'dormantmaster',
			method:   'deleteAppDoor',
			title:    door.title,
			doorId:   door.uniqueId
		} );
	},
	addEvent: function( eventObject )
	{
		var mesg = {};
		for( var a in eventObject ) mesg[a] = eventObject[a];
		mesg.type = 'dormantmaster';
		mesg.method = 'addevent';
		Application.sendMessage( mesg );
	},
	pollEvent: function( eventObject )
	{
		var mesg = {};
		for( var a in eventObject ) mesg[a] = eventObject[a];
		mesg.type = 'dormantmaster';
		mesg.method = 'pollevent';
		Application.sendMessage( mesg );
	},
	delApplicationEvents: function( appname )
	{
		var mesg = { applicationName: appname };
		mesg.type = 'dormantmaster';
		mesg.method = 'delappevents';
		Application.sendMessage( mesg );
	}
};

// ApplicationStorage ----------------------------------------------------------

ApplicationStorage = {
	setItem : function( id, data, callback )
	{
		var bundle = {
			id : id,
			data : data,
		};
		var msg = {
			method : 'set',
			data : bundle,
		};
		ApplicationStorage.send( msg, callback );
	},
	
	getItem : function( id, callback )
	{
		var msg = {
			method : 'get',
			data : {
				id : id,
			},
		};
		ApplicationStorage.send( msg, callback );
	},
	
	removeItem : function( id, callback )
	{
		var msg = {
			method : 'remove',
			data : {
				id : id,
			},
		};
		ApplicationStorage.send( msg, callback );
	},
	
	send : function( msg, callback )
	{
		console.log( 'api.ApplicationStorage.send', msg );
		if ( callback ) {
			var callbackId = addCallback( callback );
			msg.callbackId = callbackId;
		}
		
		msg.type = 'applicationstorage';
		Application.sendMessage( msg );
	},
};

// Doors object abstraction ----------------------------------------------------

Doors = {
	getScreens: function( callback )
	{
		var cid = addCallback( callback );
		Application.sendMessage( {
			type: 'system',
			command: 'getopenscreens',
			cid: cid
		} );
	}
}

// Door abstraction ------------------------------------------------------------

function Door( path )
{
	this.path = path;
	this.handler = 'void';
	var door = this;
	this.initialized = false;
	// Initialize door object
	this.init = function()
	{
		// Init a real door object and run callback function
		Application.sendMessage( 
			{
				type:    'door',
				method:  'init',
				path:    path,
				handler: this.handler
			}, 
			function( data )
			{
				if( data.handler && data.handler != 'void' )
				{
					door.initialized = true;
					door.handler = data.handler;
					if( door.onInit )
						door.onInit( data );
				}
			} 
		);
	}
	this.init();
	// Get files on current dir
	this.getIcons = function( callback )
	{
		Application.sendMessage( 
			{
				type:   'door',
				method: 'geticons',
				path: this.path,
				handler: this.handler
			},
			function( data )
			{
				if( callback )
				{
					var objects = JSON.parse( data.data );
					if( typeof( objects ) == 'object' )
					{
						var o = [];
						for( var a in objects )
							o.push( objects[a] );
						callback( o );
					}
					else if( objects )
					{
						callback( objects );
					}
					else callback( false );
				}
			}
		);
	}
}

// File dialogs ----------------------------------------------------------------

function Filedialog( mainWindow, triggerFunction, path, type )
{
	if ( !mainWindow ) return;
	if ( !triggerFunction ) return;
	if ( !type ) type = 'open';
	
	var dialog = this;
	
	var cid = addCallback( triggerFunction );
	
	Application.sendMessage( {
		type:      'system',
		command:   'filedialog',
		method:    'open',
		callbackId: cid,
		dialogType: type,
		path:       path,
		windowId:   mainWindow.getWindowId()
	} );
}

// Get a path from fileinfo and return it
function FiledialogPath( fileinfo )
{
	var path = fileinfo.Path ? fileinfo.Path : fileinfo.Title;
	path = path.split( '/' );
	path.pop();
	path = path.join( '/' );
	return path;
}

// Libraries -------------------------------------------------------------------
function Library( libraryName )
{
	var cid = addCallback( this );
	
	this.vars = [];
	
	this.addVar = function( varname, data )
	{
		this.vars[varname] = data;
	}
	
	this.execute = function( func, args )
	{
		Application.sendMessage( {
			type:       'system',
			command:    'librarycall',
			library:    libraryName,
			func:       func,
			args:       args,
			vars:       this.vars,
			callbackId: cid
		} );
	}
}

// Message passing mechanism ---------------------------------------------------

_sendMessage = function(){};
function setupMessageFunction( dataPacket, origin )
{
	// Initialize the Application callback buffer
	if( typeof( Application.callbacks ) == 'undefined' )
		Application.callbacks = [];
	
	function _sendMessage( msg, callback )
	{
		// Set info that determines where the message belongs unless already set
		if( !msg.applicationId )
		{
			msg.applicationId = dataPacket.applicationId;
		}
		if( !msg.authId )
		{
			msg.authId = dataPacket.authId;
		}
		if( !msg.theme )
		{
			msg.theme = dataPacket.theme;
		}
		if( !msg.userId )
		{
			msg.userId = dataPacket.userId;
		}
		if( !msg.windowId )
		{
			if( dataPacket.windowId ) 
				msg.windowId = dataPacket.windowId;
		}
		if( !msg.screenId )
		{
			if( dataPacket.screenId )
				msg.screenId = dataPacket.screenId;
		}
	
		// Support callback function
		if( callback )
		{
			var uid = generateUniqueId( Application.callbacks );
			Application.callbacks[uid] = callback;
			msg.callback = uid;
		}
		
		// Post the message
		parent.postMessage( JSON.stringify( msg ), origin ? origin : dataPacket.origin );
	}
	return _sendMessage;
}

// Open a library --------------------------------------------------------------

// TODO: Make it work!
// TODO: OR REMOVE IT :)
function OpenLibrary( path, id, div )
{	
	// Anchor point
	var lib = new Object ();
	lib.loaded = false;
	
	if( !div && id ) div = ge( id );
	
	// Load the library and get code back
	var m = new cAjax ();
	m.open ( 'post', path.split( /progdir\:/i ).join( Application.appPath ? Application.appPath : Application.filePath ), true, true );
	m.addVar ( 'fileInfo', JSON.stringify ( { 'Path' : path, 'Mode' : 'raw' } ) );
	m.app = this;
	m.onload = function ()
	{
		// Connect on an iframe
		var ifr = document.createElement ( 'iframe' );
		ifr.setAttribute( 'sandbox', 'allow-same-origin allow-forms allow-scripts' );
		var r = this;
		ifr.src = 'http://' + Application.filePath.split( 'http://' )[1].split( '/' )[0] + '/webclient/sandboxed.html';
		ifr.onload = function () 
		{
			var d = this.document ? this.document.documentElement : this.contentWindow.document;
			d.write ( '<html><head></head><body><script>' + this.responseText() + '</script></body></html>' );
			
			// Tell that library is loaded
			lib.library = this.document ? this.document : this.contentWindow;
			lib.loaded = true;
			// Run onload function if possible
			if ( typeof ( lib.onLoad ) == 'function' )
			{
				lib.onLoad ();
			}
		}
		// Use master window instead of body
		if ( div )
		{
			div.appendChild ( ifr );
		}
		else if ( this.app.masterView ) this.app.masterView._window.appendChild ( ifr );
		else document.body.appendChild ( ifr );
	}
	m.send ();
	return lib;
}


// For application frames ------------------------------------------------------

function initApplicationFrame( packet, eventOrigin )
{
	if( window.frameInitialized ) return;
	
	// Don't do this twice
	window.frameInitialized = true;
	
	var b = document.createElement( 'base' );
	b.href = packet.base ? packet.base : packet.domain ? packet.domain : packet.filePath;
	document.getElementsByTagName( 'head' )[0].appendChild( b );
	if( !packet.filePath ) packet.filePath = '';
	
	// Just so we know which window we belong to
	if( packet.windowId )
		Application.windowId = packet.windowId;
	
	// Load translations
	function loadLocale( path, callback )
	{
		// We need a path
		if( !path ) return callback();
		
		var language = 'en';
		var url = path + 'Locale/' + language + '.lang';
		var j = new cAjax();
		j.open( 'get', url, true );
		j.onload = function()
		{
			var ar = this.responseText().split( "\n" );
			var out = [];
			for( var a = 0; a < ar.length; a++ )
			{
				var d = ar[a].split( ":" );
				var k = Trim( d[0] );
				var v = Trim( d[1] );
				if( k.length && v.length )
					out[k] = v;
			}
			window.translations = out;
			
			// Tell, yes we're loaded now!
			callback();
		}
		j.send();
	}
	
	// On page load
	function onLoaded()
	{
		function doneLoading()
		{
			setTimeout( function()
			{
				document.body.className = '';
				document.body.style.visibility = 'visible';
			}, 200 );
		}
		
		// We need to wait for all functions to be available
		if( typeof( ge ) == 'undefined' || typeof( Trim ) == 'undefined' || typeof( cAjax ) == 'undefined' )
		{
			return setTimeout( onLoaded, 50 );
		}
		
		var tpath = '/webclient/theme/theme.css';
		if( packet && packet.theme )
		{
			tpath = '/themes/' + packet.theme + '/theme.css';
		}
				
		ParseCssFile( tpath, '/webclient/' );
		var css = [
			'font-awesome.min.css'
		];
		css.forEach( addCss );
		function addCss( cssPath )
		{
			var css = document.createElement( 'link' );
			css.type = 'text/css';
			css.rel = 'stylesheet';
			css.onload = doneLoading;
			document.head.appendChild( css );
			css.href = '/webclient/css/' + cssPath;
		}
		
		// For templates
		if( packet.appPath )
			Application.appPath = packet.appPath;
		
		
		// TODO: Take language var from config
		if( packet && packet.filePath )
		{
			// Load translations and run locale
			loadLocale( packet.filePath, function(){ if( Application.run ) { Application.run( packet ); window.applicationStarted = true; } } );
		}
		
		// Try to run scripts
		if( packet.data && packet.data.match( /\<script/i ) )
			RunScripts( packet.data );
		
		// Tell we're registered	
		Application.sendMessage( {
			type:            'notify',
			data:            'registered',
			registerCallback: packet.registerCallback,
			windowId:         packet.windowId
		} );
		
		window.loaded = true;
	}
	
	// Make sure we don't show gui until the scrollbars have changed
	// The scrollbars takes some milliseconds to load and init..
	// TODO: Figure out why we can't load scrollbars immediately
	var head = document.getElementsByTagName( 'head' )[0];
	
	var spath = '/webclient/theme/scrollbars.css';
	if( packet && packet.theme )
		spath = '/themes/' + packet.theme + '/scrollbars.css';
	
	setTimeout( function(){
		var basecss = document.createElement( 'link' );
		basecss.rel = 'stylesheet';
		basecss.href = spath;
		head.appendChild( basecss );
		document.body.style.display = '';
	}, 0 );
	
	var js = [ 
		'js/utils/engine.js',
		'js/io/cajax.js',
		'js/io/friendlibrary.js',
		'js/utils/json.js',
		'js/utils/cssparser.js'
	];
	for ( var a = 0; a < js.length; a++ )
	{
		var s = document.createElement( 'script' );
		// Set src with some rules whether it's an app or a Doors component
		s.src = '/webclient/' + js[a];
		
		// When last javascript loads, parse css, setup translations and say:
		// We are now registered..
		if( a == js.length-1 )
		{
			s.onload = function()
			{
				if( typeof( Workspace ) == 'undefined' )
				{
					if( typeof( InitWindowEvents ) != 'undefined' ) InitWindowEvents();
					if( typeof( InitGuibaseEvents ) != 'undefined' ) InitGuibaseEvents();
				}
				onLoaded();
			}
		}
		head.appendChild( s );
	}
	
	// Setup application id from message
	Application.applicationId = packet.applicationId;
	Application.userId = packet.userId;
	Application.authId = packet.authId;
	Application.theme  = packet.theme;
	
	// Autogenerate this
	Application.sendMessage = setupMessageFunction( packet, eventOrigin ? eventOrigin : packet.origin );
}

// Register clicks as default: 
// TODO: Make configurable (click to focus behavious)
function clickToActivate()
{
	Application.sendMessage( {
		type:     'view',
		method:   'activate'
	} );
	// Add class
	document.body.className = document.body.className.split( ' activated' ).join ( '' ) + ' activated';
}

// Say command
if( typeof( Say ) == 'undefined' )
{
	function Say( string )
	{
		var v = speechSynthesis.getVoices();
		var u = new SpeechSynthesisUtterance( string );
		u.lang = 'en-US';
		for( var a = 0; a < v.length; a++ )
		{
			if( v[a].name == 'Google US English' )
			{
				u.lang = v[a].lang;
				u.voice = v[a].voiceURI;
				break;
			}
		}
		speechSynthesis.speak( u );
	}
}

// Handle keys in iframes too!
if( typeof( _kresponse ) == 'undefined' || !window._keysAdded )
{
	// Handle keys
	function _kresponse( e )
	{
		var win = false;
		for( var a in Application.windows )
		{
			if( Application.windows[a].activated )
			{
				win = Application.windows[a];
				break;
			}
		}
	
		var k = e.which ? e.which : e.keyCode;
		
		// Window keys
		if( win && win.handleKeys )
		{
			win.ctrlKey = false;
			win.shiftKey = false;
			if( e.ctrlKey ) win.ctrlKey = true;
			if( e.shiftKey ) win.shiftKey = true;
			var abort = false;
			if( e.ctrlKey )
			{
				switch ( k )
				{
					// q for quit
					case 81:
						abort = true;
						win.close ();
						break;
				}
			}
			if( win.handleKeys( k, e ) )
				return cancelBubble ( e );
		}
		// Some fallbacks
		else
		{
			if( e.ctrlKey )
			{
				switch ( k )
				{
					// q for quit
					case 81:
						abort = true;
						Application.quit();
						break;
					case 77:
						Application.sendMessage( {
							type: 'system',
							command: 'switchscreens'
						} );
						break;
				}
			}
		}
		
		// Application wide
		if( Application.handleKeys && Application.activated )
		{
			if( Application.handleKeys( k, e ) )
				return cancelBubble( e );
		}
		
		if( abort )
			return cancelBubble( e );
	}
	function _kresponseup( e )
	{
		var win = false;
		for( var a in Application.windows )
		{
			if( Application.windows[a].activated )
			{
				win = Application.windows[a];
				break;
			}
		}
		
		if ( win && ( e.ctrlKey || e.shiftKey ) && typeof ( win.handkeKeys ) )
		{
			if ( e.preventDefault ) e.preventDefault ();
			return cancelBubble ( e );
		}
	}
	if ( window.addEventListener )
	{
		window.addEventListener( 'keydown', _kresponse,   false );
		window.addEventListener( 'keyup',   _kresponseup, false );
	}
	else
	{
		window.attachEvent( 'onkeydown', _kresponse,   false );
		window.attachEvent( 'onkeyup',  _kresponseup, false );
	}
	
	
	
	window._keysAdded = true;
}

/* Event handlers ----------------------------------------------------------- */

if( window.addEventListener )
{
	window.addEventListener( 'click', clickToActivate, true );
	window.addEventListener( 'message', receiveEvent, false );
}
else 
{
	window.attachEvent( 'onclick', clickToActivate, true );
	window.attachEvent( 'onmessage', receiveEvent, false );
}

// Make sure we can catch relative mouse pointer coordinates
if( typeof( windowMouseX ) == 'undefined' )
{
	// Init on the outside
	windowMouseX = -1;
	windowMouseY = -1;
	
	// The actual mouse event
	function mouseEvt( e )
	{
		if( !e ) e = window.event;
		var mx = e.clientX ? e.clientX : e.pageXOffset;
		var my = e.clientY ? e.clientY : e.pageYOffset;
		// We will only allow numbers
		if( typeof( mx ) == 'undefined' ) mx = -1;
		if( typeof( my ) == 'undefined' ) my = -1;
		
		windowMouseX = mx;
		windowMouseY = my;
	}
	if( window.addEventListener )
		window.addEventListener( 'mousemove', mouseEvt, false );
	else window.attachEvent( 'onmousemove', mouseEvt, false );
}

