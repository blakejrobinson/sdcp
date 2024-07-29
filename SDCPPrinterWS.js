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
	#AutoReconnect = false;
	/** Time between reconnect attempts */
	#ReconnectInterval = 5000;
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
	 * Set up autoreconnect
	 * @param {boolean|number} value - Whether or not to autoreconnect. If a number is provided it will be the time between reconnect attempts
	 * @returns {void}
	 */
	set AutoReconnect(value) 
	{
		if (value === false  || value === true)
			this.#AutoReconnect = value;
		else if (typeof value === 'number')
		{
			this.#ReconnectInterval = value;
			this.#AutoReconnect = true;
		}
	}
	get AutoReconnect() {return this.#AutoReconnect;}

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
			this.#Websocket.close();
		}

		var Printer = this;
		this.#Websocket = new WebSocket(`ws://${MainboardIP}:3030/websocket`, {timeout: 5000});
		this.#Websocket.on('open', ()=>
		{
			if (debug) console.log(`Websocket connected to ${this.#Websocket._socket.remoteAddress}:${this.#Websocket._socket.remotePort}`);
			this.Connected = true;
			this.emit('connected', { ip: this.#Websocket._socket.remoteAddress, port: this.#Websocket._socket.remotePort, reconnect: this.Reconnecting === true});
			if (this.Reconnecting)
			{
				delete this.Reconnecting;
				this.emit('reconnected', { ip: this.#Websocket._socket.remoteAddress, port: this.#Websocket._socket.remotePort});
			}

			if (Callback) Callback.call(Printer);
			Callback = undefined;
			//this.SendCommand(new SDCPCommand.SDCPCommandAttributes());
			//this.SendCommand(new SDCPCommand.SDCPCommandStatus());
		});
	
		this.#Websocket.on('message', (data) => 
		{
			if (debug) console.log(`Websocket received message: ${data}`);

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
					this.emit('status', Command.Status);
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
					this.emit('attributes', Command.Attributes);
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
			if (error.message === "getaddrinfo ENOTFOUND _test_") return;

			if (debug) console.error(`Websocket error: ${error}`);
			//this.emit('error', error);
			if (this.#AutoReconnect === false && Callback) 
			{
				Callback.call(Printer, error);
				Callback = undefined;
			}
		});
	
		//Socket closed
		this.#Websocket.on('close', () => 
		{
			if (debug) console.log(`Websocket disconnected`);
			this.#Websocket = undefined;			
			if (this.Connected)
			{
				this.Connected = false;
				this.emit('disconnected');	
			}

			//Should we try to reconnect?
			if (this.#AutoReconnect !== false)
			{
				this.Reconnecting = !this.Reconnecting ? 1 : this.Reconnecting + 1;
				if (debug) console.log(`Attempting to reconnect ${this.Reconnecting} in ${Printer.#ReconnectInterval/1000} seconds...`);				
				setTimeout(()=>{Printer.Connect(MainboardIP, (err)=>{});}, Printer.#ReconnectInterval);
			}
		});		

		//Simulate it already being connected for automatic reconnection tests
		if (MainboardIP === "_TEST_")
		{
			this.#Websocket._socket = {remoteAddress: this.MainboardIP, remotePort: 3030};
			this.#Websocket.emit("open");
			this.#Websocket._socket = undefined;
			Callback = undefined
			MainboardIP = this.MainboardIP;			
		}
	}

	Disconnect()
	{
		if (this.#Websocket)
			this.#Websocket.close();
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

	/**
	 * Calculate MD5 hash of a file
	 * @param {string} filePath - Path to the file
	 * @returns {Promise<string>} - MD5 hash of the file
	 */
	async #calculateFileMD5(filePath) 
	{
		return new Promise((resolve, reject) => 
		{
			const hash = crypto.createHash('md5');
			const stream = fs.createReadStream(filePath);
			stream.on('data', (data) => hash.update(data));
			stream.on('end', () => resolve(hash.digest('hex')));
			stream.on('error', reject);
		});
	}
		
	/**
	 * Upload a file to the printer
	 * @param {string} File - The path to the file to upload
	 * @param {{Verification: boolean, ProgressCallback: function(Progress): void}} Options - The options to use
	 * @param {function(Error?, Object): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	async UploadFile(File, Options, Callback)
	{
		if (typeof Options === 'function') {Callback = Options; Options = {};}
		if (Options === undefined) Options = {};
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.UploadFile(File, Options, (err,response) => {if (err) return reject(err); resolve(response);});});

		const { Verification = true, ProgressCallback } = Options;
		const fileStats = await fs.promises.stat(File);
		const totalSize = fileStats.size;
		const chunkSize = 1024 * 1024; // 1MB chunks
		const uuid = crypto.randomBytes(32).toString('hex');

		let uploadedSize = 0;
		let md5Hash = crypto.createHash('md5');
		let Result = undefined;
		let filename = path.basename(File);
		const fileMD5 = await this.#calculateFileMD5(File);

		if (typeof ProgressCallback === 'function') 
			ProgressCallback({Status: "Preparing",
						"S-File-MD5": fileMD5,
						Uuid: uuid,
						Offset: uploadedSize,
						TotalSize: totalSize,
						Complete: uploadedSize / totalSize,
						File: filename});

		const fileHandle = await fs.promises.open(File, 'r');
		try 
		{
			while (uploadedSize < totalSize) 
			{
				const buffer = Buffer.alloc(chunkSize);
				const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, uploadedSize);
				if (bytesRead === 0) break;			
			
				const chunk = buffer.slice(0, bytesRead);
				md5Hash.update(chunk);

				const formData = new FormData();
				formData.append('Uuid', uuid);
				formData.append('Offset', uploadedSize.toString());
				formData.append('TotalSize', totalSize.toString());
				formData.append('Check', Verification ? '1' : '0');
				formData.append('S-File-MD5', fileMD5);
				formData.append('File', new Blob([chunk]), filename);//  { filename: 'chunk' });
				
				if (debug) console.log(`Uploading chunk of size ${chunk.length} bytes`);
				const response = await fetch(`http://${this.MainboardIP}:3030/uploadFile/upload`, 
				{
					method: 'POST',
					body: formData
				});
		
				if (!response.ok) 
				{
					const errorData = await response.json();
					if (debug) console.error(`Upload failed: ${JSON.stringify(errorData)}`);
					throw new Error(`Upload failed: ${JSON.stringify(errorData)}`);
				}
				else 
					Result = await response.json();
		
				uploadedSize += chunk.length;
				if (typeof ProgressCallback === 'function') 
					ProgressCallback({Status: "Uploading",
								"S-File-MD5": fileMD5,
								Uuid: uuid,
								Offset: uploadedSize,
								TotalSize: totalSize,
								Complete: uploadedSize / totalSize,
								File: filename});
			}	

			if (debug) console.log('File upload completed successfully');			
		}
		finally 
		{
      		await fileHandle.close();			
    	}

		Callback(undefined, {Status: "Complete",
							 "S-File-MD5": fileMD5,
							 Uuid: uuid,
							 Offset: uploadedSize,
							 TotalSize: totalSize,
							 Complete: uploadedSize / totalSize,
							 File: filename,
							 Success: Result && Result.success ? true : false,
							 Result: Result});
	}
}

module.exports = SDCPPrinterWS;