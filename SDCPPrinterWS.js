const SDCPConstants = require('./Constants');
const SDCPCommand  = require('./SDCPCommand');
const EventEmitter = require('events');
const WebSocket = require('ws');
const dgram = require('dgram');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const debug = false;

/**
 * Represents an SDCP (Simple Device Control Protocol) Printer controlled via Websockets
 * @class
 */
class SDCPPrinterWS extends require("./SDCPPrinter")
{
	/** The websocket for this printer */
	#Websocket = undefined;
	/** Whether or not it should try to autoreconnect */
	#AutoReconnect = true;
	/** Request queue */
	#Requests = [];
	/** Route statuses (FIFO queue) */
	#StatusRoute = [];
	/** Route statuses (FIFO queue) */
	#AttributeRoute = [];
	/** Last received status cache	 */
	#LastStatus = undefined;
	/** Last received attributes cache	 */
	#LastAttributes = undefined;

	/**
	 * Connect to the printer
	 * @param {string} [MainboardIP] - The IP address of the printer to connect to. If left blank it will use the MainboardIP property
	 * @param {function(Error?): void} [Callback] - Callback function to be called when the connection is established
	 * @returns {Promise<void>} - Promise that resolves when the connection is established
	 */
	Connect(MainboardIP, Callback)
	{
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.Connect(MainboardIP, function(err) {if (err) return reject(err); resolve();});});

		if (typeof MainboardIP === 'function') {Callback = MainboardIP; MainboardIP = undefined;}
		if (MainboardIP === undefined) MainboardIP = this.MainboardIP;

		if (MainboardIP === undefined)
			return Callback(new Error('No IP address provided'));

		//If we do not have the properties of this printer, we need to get them
		if (this.Id === undefined)
		{
			if (debug) console.log('Missing printer info. Retrieving it via broadcast...');
			this.Broadcast(MainboardIP, (err) =>
			{
				if (err) return Callback(err);
				this.Connect(MainboardIP, Callback);
			});
			return;
		}

		//Requires protocol >= V3.0.0
		if (this.ProtocolVersion === 'V1.0.0' || this.ProtocolVersion === 'V2.0.0')
			return Callback(new Error('Printer does not support Websocket control'));		
			
		if (this.#Websocket)
		{
			this.#Websocket.off('open');
			this.#Websocket.off('close');
			this.#Websocket.off('error');
			this.#Websocket.off('message');
			this.#Websocket.off('status');
			this.#Websocket.off('attributes');			
			this.#Websocket.off('notice');
			this.#Websocket.close();
		}

		var Printer = this;
		this.#Websocket = new WebSocket(`ws://${MainboardIP}:3030/websocket`);
		this.#Websocket.on('open', ()=>
		{
			if (debug) console.log(`Connected to ${this.#Websocket._socket.remoteAddress}:${this.#Websocket._socket.remotePort}`);
			this.emit('connected', { ip: this.#Websocket._socket.remoteAddress, port: this.#Websocket._socket.remotePort });
			if (Callback) Callback.call(Printer);
			Callback = undefined;
			this.Connected = true;
			//this.SendCommand(new SDCPCommand.SDCPCommandAttributes());
			//this.SendCommand(new SDCPCommand.SDCPCommandStatus());
		});
	
		this.#Websocket.on('message', (data) => 
		{
			if (debug) console.log(`Received message: ${data}`);

			//Check if it's a response
			var Command = {};
			try
			{
				Command = JSON.parse(data.toString());
				if (Command.Topic === `sdcp/notice/${this.MainboardID}`)
					return this.emit('notice', Command);
				if (Command.Topic === `sdcp/error/${this.MainboardID}`)
				{
					if (Command.Data.Data.ErrorCode !== undefined)
						Command.Data.Data.ErrorText = SDCPConstants.SDCP_ERROR_CODE_DESCRIPTIONS[Command.Data.Data.ErrorCode];
					this.emit('error', Command);
					return;
				}				
				if (Command.Topic === `sdcp/status/${this.MainboardID}`)
				{
					if (this.#StatusRoute.length > 0)
					{
						var Callback = this.#StatusRoute.shift();
						if (typeof Callback === "function")
							Callback(null, Command);
					}
					else
						this.#LastStatus = {...Command.Status, Timestamp: Command.Timestamp};
					this.emit('status', Command);
					return;
				}
				if (Command.Topic === `sdcp/attributes/${this.MainboardID}`)
				{
					if (this.#AttributeRoute.length > 0)
					{
						var Callback = this.#AttributeRoute.shift();
						if (typeof Callback === "function")
							Callback(null, Command);
					}
					else
						this.#LastAttributes = {...Command.Attributes, Timestamp: Command.Timestamp};
					this.emit('attributes', Command);
					return;
				}				

				if (Command.Topic === `sdcp/response/${this.MainboardID}` && Command.Data && Command.Data.RequestID)
				{
					var Request = this.#Requests.find((r) => r.Data.RequestID === Command.Data.RequestID);
					if (typeof Request.Callback !== "function") return;

					if (Request && (Request.Data.Cmd === 0 || Request.Data.Cmd === 1))
					{
						//Error? Pass on the error
						if (Command.Data.Data.Ack !== 0)
						{
							if (typeof Request.Callback === "function")
								Request.Callback(null, Command);
							this.#Requests.splice(this.#Requests.indexOf(Request), 1);
							return;
						}

						//Status? Wait for the status update and pass that on
						if (typeof Request.Callback === "function")
								Request.Data.Cmd === 0 ? this.#StatusRoute.push(Request.Callback)
													   : this.#AttributeRoute.push(Request.Callback);
						return;
					}

					//Else pass on the response
					if (Request && typeof Request.Callback === "function")
					{
						Request.Callback(null, Command);
						this.#Requests.splice(this.#Requests.indexOf(Request), 1);
					}
					return;
				}

			} catch(err) 
			{
				if (debug) console.error('    Error parsing JSON:', err);
				return;
			}

			this.emit('message', data);
		});
	
		this.#Websocket.on('error', (error) => 
		{
			if (debug) console.error(`Error: ${error}`);
			//this.emit('error', error);
			if (Callback) Callback.call(Printer, error);
				Callback = undefined;
		});
	
		this.#Websocket.on('close', () => 
		{
			if (debug) console.log(`Disconnected`);
			this.emit('disconnected');
			this.#Websocket = undefined;
			this.Connected = false;
			if (this.#AutoReconnect !== false)
				setTimeout(()=>{this.Connect.call(Printer, (err)=>{});}, 5000);
		});		
	}

	/**
	 * Get the status of the printer
	 * @param {boolean} [Cached=false] - Whether or not to use the cached status
	 * @param {function(Error?, Object): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	GetStatus(Cached = false, Callback)
	{
		if (typeof Cached === 'function') {Callback = Cached; Cached = false;}		
		if (Cached !== true || this.#LastStatus === undefined) 
			return super.GetStatus(false, Callback);
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.GetStatus(Cached, (err,status) => {if (err) return reject(err); resolve(status);});});

		Callback(undefined, this.#LastStatus);
	}

	/**
	 * Get the attributes of the printer
	 * @param {boolean} [Cached=false] - Whether or not to use the cached attributes
	 * @param {function(Error?, Object): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	GetAttributes(Cached = false, Callback)
	{
		if (typeof Cached === 'function') {Callback = Cached; Cached = false;}		
		if (Cached !== true || this.#LastAttributes === undefined)
			return super.GetAttributes(false, Callback);
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.GetAttributes(Cached, (err,status) => {if (err) return reject(err); resolve(status);});});

		Callback(undefined, this.#LastAttributes);
	}	

	/**
	 * Send a command to the printer
	 * @param {SDCPCommand|{Id: string, Data: {Cmd: number, Data: Object}, RequestID: string}|number} Command - The command to send to the printer
	 * @param {Object} [Parameters] - The parameters to send with the command
	 * @param {function(Error?, Response): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Response>} - Promise that resolves with the response from the printer
	 */
	SendCommand(Command, Parameters, Callback)
	{
		if (typeof Parameters === 'function') {Callback = Parameters; Parameters = undefined;}		

		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.SendCommand(Command, Parameters, (err,response) => {if (err) return reject(err); resolve(response);});});
		if (!this.#Websocket)
			Callback(new Error('Not connected to printer'));
		if (typeof Command === 'number') Command = {Data: {Cmd: Command}};
		
		if (typeof Command !== 'object') 				Command = {};
		if (Command.Id === undefined) 					Command.Id = this.Id;
		if (typeof Command.Data !== 'object') 			Command.Data = {};
		if ( Command.Data.MainboardID === undefined) 	Command.Data.MainboardID = this.MainboardID;
		if ( Command.Data.Data === undefined) 			Command.Data.Data = {};
		if ( Command.Data.RequestID === undefined) 		Command.Data.RequestID = crypto.randomBytes(16).toString('hex');
		if ( Command.Data.Timestamp === undefined) 		Command.Data.Timestamp = parseInt(Date.now()/1000);
		if ( Command.Data.From === undefined) 			Command.Data.From = SDCPConstants.SDCP_FROM.PC;
		if ( Command.Topic === undefined) 				Command.Topic = `sdcp/request/${this.MainboardID}`;
		if (Parameters !== undefined && typeof Parameters === 'object')
			Command.Data.Data = {...Command.Data.Data, ...Parameters};
	
		this.#Requests.push({...Command, Callback: Callback});
		this.#Websocket.send(JSON.stringify(Command));
		if (debug) console.log(JSON.parse(JSON.stringify(Command), undefined, "\t"));
	}

}

module.exports = SDCPPrinterWS;