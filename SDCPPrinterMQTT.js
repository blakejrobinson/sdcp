const SDCPConstants = require('./Constants');
const SDCPCommand  = require('./SDCPCommand');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const dgram = require('dgram');

const debug = false;
const KEEP_CONSISTENT = true;

const HTTPServer = require('./SDCPHTTPServer');
const MQTTServer = require('./SDCPMQTTServer');
const mqttServer = require('mqtt-server');
/** MQTTServer  */
var MQTTServerInstance = undefined;

/**
 * Represents an SDCP (Simple Device Control Protocol) Printer controlled via Websockets
 * @class
 */
class SDCPPrinterMQTT extends require("./SDCPPrinter")
{
	/** Whether or not it should try to autoreconnect */
	#_AutoReconnect = false;
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

	constructor(Config)
	{
		super(Config);
		if (Config && Config.AutoReconnect)
		{
			this.AutoReconnect = Config.AutoReconnect;
			delete Config.AutoReconnect;
		}		
	}

	/** 
	 * Set up autoreconnect
	 * @param {boolean|number} value - Whether or not to autoreconnect. If a number is provided it will be the time between reconnect attempts
	 * @returns {void}
	 */
	set AutoReconnect(value) 
	{
		if (value === false  || value === true)
			this.#_AutoReconnect = value;
		else if (typeof value === 'number')
		{
			this.#ReconnectInterval = value;
			this.#_AutoReconnect = true;
		}
	}
	get AutoReconnect() {return this.#_AutoReconnect;}

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

		//Requires protocol != V3.0.0
		if (this.ProtocolVersion === 'V3.0.0')
			return Callback(new Error('Printer does not support UDP control'));

		if (MQTTServerInstance === undefined)
		{
			if (debug) console.log('Starting MQTT server...');
			MQTTServerInstance = new MQTTServer();
			MQTTServerInstance.Listen();
		}
		
		MQTTServerInstance.on(`connect_${this.MainboardID}`, 	(socket)   => 
		{
			this.Connected = true;	
			this.emit('connected', { ip: socket.remoteAddress, port: socket.remotePort, reconnect: this.Reconnecting === true});
			if (this.Reconnecting)
			{
				delete this.Reconnecting;
				this.emit('reconnected');
			}
			if (this.timeoutWatch)
			{
				clearTimeout(this.timeoutWatch);
				delete this.timeout
			}
			MQTTServerInstance.subscribeToTopic(socket, `/sdcp/response/${this.MainboardID}`);
			MQTTServerInstance.subscribeToTopic(socket, `/sdcp/request/${this.MainboardID}`);

			//Lets subscribe the printer to the topics (just in case)
			if (Callback) Callback.call(this);
			Callback = undefined;

		});
		MQTTServerInstance.on(`disconnect_${this.MainboardID}`, (id)   => 
		{
			if (this.Connected)
			{
				this.Connected = false;	
				this.emit('disconnected');
			}

			MQTTServerInstance.removeAllListeners(`connect_${this.MainboardID}`         );
			MQTTServerInstance.removeAllListeners(`disconnect_${this.MainboardID}`      );
			MQTTServerInstance.removeAllListeners(`/sdcp/status/${this.MainboardID}`    );
			MQTTServerInstance.removeAllListeners(`/sdcp/attributes/${this.MainboardID}`);
			MQTTServerInstance.removeAllListeners(`/sdcp/response/${this.MainboardID}`  );

			//Should we try to reconnect?
			if (this.#_AutoReconnect !== false)
			{
				this.Reconnecting = this.Reconnecting ? this.Reconnecting + 1 : 1;
				if (debug) console.log(`Attempting to reconnect ${this.Reconnecting} in ${this.#ReconnectInterval/1000} seconds...`);				
				setTimeout(()=>{this.Connect(MainboardIP, (err)=>
				{
					if (!err && Callback)
						Callback();
					Callback = undefined;
				});}, this.#ReconnectInterval);
			}
		});
		MQTTServerInstance.on(`/sdcp/response/${this.MainboardID}`, (Command) => 
		{
			if (debug) console.log(`Received response: ${JSON.stringify(Command)}`);

			var Request = this.#Requests.find((r) => r.Data.RequestID === Command.Data.RequestID);
			if (typeof Request.Callback !== "function") return;

			if (Request && (Request.Data.Cmd === 0 || Request.Data.Cmd === 1))
			{
				//Error? Pass on the error
				if (Command.Data.Data.Ack !== 0)
				{
					if (typeof Request.Callback === "function")
						Request.Callback(null, Command.Data);
					this.#Requests.splice(this.#Requests.indexOf(Request), 1);
					return;
				}

				//Status? Wait for the status update and pass that on
				if (typeof Request.Callback === "function")
						Request.Data.Cmd === 0 ? this.#StatusRoute.push(Request.Callback)
											   : this.#AttributeRoute.push(Request.Callback);
				return;			
			}
		});
		MQTTServerInstance.on(`/sdcp/status/${this.MainboardID}`, (Command) => 
		{
			if (debug) console.log(`Received status: ${JSON.stringify(Command)}`);
			if (this.#StatusRoute.length > 0)
			{
				var Callback = this.#StatusRoute.shift();
				if (typeof Callback === "function")
					Callback(null, Command.Data);
			}
			else
			{
				//Adjust to make it match V3.0.0 for consistency
				if (KEEP_CONSISTENT && Command && Command.Data && Command.Data.Status && Command.Data.Status.CurrentStatus !== undefined)
					Command.Data.Status.CurrentStatus = [Command.Data.Status.CurrentStatus];
				if (JSON.stringify(Command.Data.Status) !== JSON.stringify(this.#LastStatus))
					this.emit('status', Command.Data.Status);
				this.#LastStatus = {...Command.Data.Status, Timestamp: Command.Timestamp};
			}

		});
		MQTTServerInstance.on(`/sdcp/attributes/${this.MainboardID}`, (Command) => 
		{
			if (this.#AttributeRoute.length > 0)
			{
				var Callback = this.#AttributeRoute.shift();
				if (typeof Callback === "function")
					Callback(null, Command);
			}
			else	
			{		
				//if (debug) console.log(`Received attributes: ${JSON.stringify(data)}`);
				if (JSON.stringify(Command.Data.Attributes) !== this.#LastAttributes)
					this.emit('attributes', Command.Data.Attributes);
				this.#LastAttributes = {...Command.Data.Attributes, Timestamp: Command.Timestamp};
			}
		});

		var timedOut = false;
		if (this.timeoutWatch) 
			clearTimeout(this.timeoutWatch);
		this.timeoutWatch = setTimeout(() =>
		{
			return Callback ? Callback(new Error('Timeout')) : undefined;
			Callback = undefined;
			timedOut = true;
		}, 5000);

		if (debug) console.log(`Requesting ${MainboardIP} connects to MQTT...`);
		this.RequestMQTT(MainboardIP, (err) =>
		{
			if (err && err.message === "getaddrinfo ENOTFOUND _TEST_") return;			
			if (err)
			{
				if (Callback && this.#_AutoReconnect === false) 
					return Callback(err);
				MQTTServerInstance.emit(`disconnect_${this.MainboardID}`);
			}
			//Callback();				
		});			

		//Simulate it already being connected for automatic reconnection tests
		if (MainboardIP === "_TEST_")
		{
			MQTTServerInstance.emit(`connect_${this.MainboardID}` ,{remoteAddress: this.MainboardIP, remotePort: 3030});
			setTimeout(() => MQTTServerInstance.emit(`disconnect_${this.MainboardID}`), 1000);
			// this.#Websocket._socket = {remoteAddress: this.MainboardIP, remotePort: 3030};
			// this.#Websocket.emit("open");
			// this.#Websocket._socket = undefined;

			//this.#Websocket.close();
			Callback = undefined
			MainboardIP = this.MainboardIP;			
		}		
	}

	Disconnect()
	{
		if (MQTTServerInstance === undefined)
			return;
		MQTTServerInstance.disconnect(this.MainboardID);
	}

	/**
	 * @param {string} [MainboardIP] - The IP address of the printer to connect to. If left blank it will use the MainboardIP property
	 * @param {function(Error?): void} [Callback] - Callback function to be called when the connection is established
	 * @returns {Promise<void>} - Promise that resolves when the connection is established
	 */	
	RequestMQTT(MainboardIP, Callback)
	{		
		if (Callback === undefined)
			return new Promise((resolve,reject) => {this.Broadcast(MainboardIP, (err, Results) => {if (err) return reject(err); resolve(Results);});});

		if (typeof MainboardIP === 'function') {Callback = MainboardIP; MainboardIP = undefined;}
		if (MainboardIP === undefined) MainboardIP = this.MainboardIP;
		if (MainboardIP === undefined)
			return Callback(new Error('No IP address provided'));
		
		const client = dgram.createSocket('udp4');
		const discoveryMessage = 'M66666 1883';
		
		client.bind(() => client.setBroadcast(true));
		client.on('message', (msg, rinfo) => 
		{
			client.close();
		});
	
		if (debug) console.log('Broadcasting mqtt connect message...');
		client.send(discoveryMessage, 3000, MainboardIP, (err) => 
		{
			if (Callback)
			{
				if (err) return Callback(err);
				Callback();
			}
		});
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
	 * Get the status of the printer
	 * @param {boolean} [Cached=false] - Whether or not to use the cached status
	 * @param {function(Error?, Object): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	GetStatus(Cached = false, Callback)
	{
		if (typeof Cached === 'function') {Callback = Cached; Cached = false;}		
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.GetStatus(Cached, (err,status) => {if (err) return reject(err); resolve(status);});});

		this.SendCommand(new SDCPCommand.SDCPCommandStatus).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error getting status'));
			if (KEEP_CONSISTENT && response && response.Status && response.Status.CurrentStatus !== undefined)
				response.Status.CurrentStatus = [response.Status.CurrentStatus];
			Callback(undefined, response.Status);
		}).catch(err=>Callback(err));
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
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.GetAttributes(Cached, (err,attributes) => {if (err) return reject(err); resolve(attributes);});});

		if (this.#LastAttributes)
			return Callback(undefined, this.#LastAttributes);
		else
			//We want one the next time it comes in
			Callback(new Error('Not implemented'));
	}

	/**
	 * Start a print job on the printer
	 * @param {string} File - The file to print
	 * @param {number} [Layer] - The layer to start printing from
	 * @param {function(Error?): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<void>} - Promise that resolves when the command is complete
	 */
	Start(File, Layer=undefined, Callback)
	{
		if (typeof Layer === 'function') {Callback = Layer; Layer = 0;}
		if (Layer === undefined) Layer = 0;

		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.Start(File, (err) => {if (err) return reject(err); resolve();});});
		Callback(new Error('Not implemented'));
	}

	/**
	 * Pause the printer
	 * @param {function(Error?): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<void>} - Promise that resolves when the command is complete
	 */
	Pause(Callback)
	{
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.Pause((err) => {if (err) return reject(err); resolve();});});
		Callback(new Error('Not implemented'));
	}

	/**
	 * Stop the printer
	 * @param {function(Error?): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<void>} - Promise that resolves when the command is complete
	 */
	Stop(Callback)
	{
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.Stop((err) => {if (err) return reject(err); resolve();});});
		Callback(new Error('Not implemented'));
	}

	/**
	 * Get a list of files from the printer
	 * @param {string} Path - The path to get the files from
	 * @param {function(Error?, Object[]): void} [Callback] - Callback function to be called when the command is complete
	 */
	GetFiles(Path, Callback)
	{
		if (typeof Path === 'function') {Callback = Path; Path = undefined;}
		if (typeof Callback !== "function") 
			return new Promise((resolve,reject) => {this.GetFiles(Path, (err,files) => {if (err) return reject(err); resolve(files);});});
		Callback(new Error('Not implemented'));
	}

	/**
	 * Batch delete files or folders remotely
	 * @param {string|string[]} Files - The file or files to delete
	 * @param {string|string[]} [Folders] - The folder or folders to delete. Can be left out to just delete files
	 * @param {function(Error?, Object[]): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	DeleteFilesFolders(Files, Folders, Callback)
	{
		if (typeof Folders === 'function') {Callback = Folders; Folders = undefined;}

		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.DeleteFilesFolders(Files, Folders, (err) => {if (err) return reject(err); resolve();});});
		Callback(new Error('Not implemented'));	
	}

	/**
	 * Batch delete files remotely
	 * @param {string|string[]} Files - The file or files to delete
	 * @param {function(Error?, Object[]): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	DeleteFiles(Files, Callback)
	{
		return this.DeleteFilesFolders(Files, undefined, Callback);
	}

	/**
	 * Get the historical tasks from the printer
	 * @param {boolean} [Expand] - Whether or not to expand the tasks
	 * @param {function(Error?, string[]|Object[]): void} [Callback] - Callback function to be called when the command is complete
	 */
	GetHistoricalTasks(Expand=false, Callback)
	{
		if (typeof Expand === 'function') {Callback = Expand; Expand = false;}
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.GetHistoricalTasks(Expand, (err,tasks) => {if (err) return reject(err); resolve(tasks);});});
		Callback(new Error('Not implemented'));
	}

	/**
	 * Get a historical task(s) from the printer
	 * @param {string|string[]} TaskId - The ID(s) of the task to get
	 * @param {function(Error?, Object): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	GetHistoricalTaskDetails(TaskId, Callback)
	{
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.GetHistoricalTaskDetails(TaskId, (err,task) => {if (err) return reject(err); resolve(task);});});
		Callback(new Error('Not implemented'));
	}

	/**
	 * Send a command to the printer via MQTT
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
		if (!this.Connected || MQTTServerInstance === undefined)
			Callback(new Error('Not connected to printer'));
		if (typeof Command === 'number') Command = {Data: {Cmd: Command}};

		var Topic = `/sdcp/request/${this.MainboardID}`;		
		if (typeof Command !== 'object') 				Command = {};
		if (Command.Id === undefined) 					Command.Id = this.Id;
		if (typeof Command.Data !== 'object') 			Command.Data = {};
		if ( Command.Data.MainboardID === undefined) 	Command.Data.MainboardID = this.MainboardID;
		if ( Command.Data.Data === undefined) 			Command.Data.Data = {};
		if ( Command.Data.RequestID === undefined) 		Command.Data.RequestID = crypto.randomBytes(16).toString('hex');
		if ( Command.Data.Timestamp === undefined) 		Command.Data.Timestamp = parseInt(Date.now()/1000);
		if ( Command.Data.From === undefined) 			Command.Data.From = SDCPConstants.SDCP_FROM.PC;
		if (Parameters !== undefined && typeof Parameters === 'object')
			Command.Data.Data = {...Command.Data.Data, ...Parameters};
	
		//Show topics
		//console.log(Object.keys(MQTTServerInstance.Topics));
		//console.log(Topic);
		this.#Requests.push({...Command, Callback: Callback});
		MQTTServerInstance.publishToSubscribers(undefined, Topic, JSON.stringify(Command));
		if (debug) console.log(JSON.parse(JSON.stringify(Command), undefined, "\t"));
	}

	/**
	 * Upload a file to the printer
	 * @param {string} File - The path to the file to upload
	 * @param {{URL: string, Verification: boolean, ProgressCallback: function(Progress): void}} Options - The options to use
	 * @param {function(Error?, Object): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	async UploadFile(File, Options, Callback)
	{
		if (typeof Options === 'function') {Callback = Options; Options = {};}
		if (Options === undefined) Options = {};
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.UploadFile(File, Options, (err,response) => {if (err) return reject(err); resolve(response);});});

		const { Verification, ProgressCallback } = Options;
		const fileStats = await fs.promises.stat(File);
		const totalSize = fileStats.size;
		const uuid = crypto.randomBytes(32).toString('hex');

		let md5Hash = crypto.createHash('md5');
		let Result = undefined;
		let filename = path.basename(File);
		const fileMD5 = await this.#calculateFileMD5(File);

		//Track the upload!
		var FollowUpload = function(update)
		{
			try
			{
				var UploadInfo = update.Data.Status.FileTransferInfo;
				if (debug) 
					console.log(update.Data.Status.CurrentStatus);
				//console.log(UploadInfo);

				//It failed?
				if (update.Data.Status.CurrentStatus[0] === 0 && UploadInfo.Status === 3)
				{
					MQTTServerInstance.off(`/sdcp/status/${this.MainboardID}`, FollowUpload);
					//this.SendCommand(new SDCPCommand.SDCPCommandTimeperiod(5000));
					ProgressCallback({Status: "Complete", "S-File-MD5": fileMD5, Uuid: uuid, Offset: UploadInfo.DownloadOffset, TotalSize: UploadInfo.FileTotalSize, File: filename, URL: Options.URL, Complete: 1, Success: false, Result: UploadInfo});
					return Callback(new Error('Upload failed'), {Status: "Complete", "S-File-MD5": fileMD5, Uuid: uuid, Offset: UploadInfo.DownloadOffset, TotalSize: UploadInfo.FileTotalSize, File: filename, URL: Options.URL, Complete: 1, Success: false, Result: UploadInfo});
				}
				//It success?
				if (update.Data.Status.CurrentStatus[0] === 0 && UploadInfo.Status === 2)
				{
					MQTTServerInstance.off(`/sdcp/status/${this.MainboardID}`, FollowUpload);
					//this.SendCommand(new SDCPCommand.SDCPCommandTimeperiod(5000));
					ProgressCallback({Status: "Complete", "S-File-MD5": fileMD5, Uuid: uuid, Offset: UploadInfo.DownloadOffset, TotalSize: UploadInfo.FileTotalSize, File: filename, URL: Options.URL, Success: true, Complete: 1, Result: UploadInfo});
					return Callback(undefined, {Status: "Complete", "S-File-MD5": fileMD5, Uuid: uuid, Offset: UploadInfo.DownloadOffset, TotalSize: UploadInfo.FileTotalSize, File: filename, URL: Options.URL, Success: true, Complete: 1, Result: UploadInfo});
				}

				//Update the progress
				if (update.Data.Status.CurrentStatus[0] === 2)
				{
					if (typeof ProgressCallback === 'function') 
						ProgressCallback({Status: "Uploading", "S-File-MD5": fileMD5, Uuid: uuid, Offset: UploadInfo.DownloadOffset, TotalSize: UploadInfo.FileTotalSize, File: filename, URL: Options.URL, Complete: UploadInfo.DownloadOffset / UploadInfo.FileTotalSize});
				}
			}
			catch (e)
			{
				//if (debug)
					console.log(e);
			}
		}.bind(this);
		MQTTServerInstance.on(`/sdcp/status/${this.MainboardID}`, FollowUpload);

		//Start the server for a one-time file send
		var TemporaryServer;
		if (!Options || Options.URL === undefined)
		{
			TemporaryServer = new HTTPServer();
			TemporaryServer.Listen(undefined, File, uuid+".ctb", () =>
			{
				TemporaryServer.Close();
				TemporaryServer = undefined;
			});
			if (debug) console.log(`Temporarily serving ${File} as ${uuid}.ctb`);
		}

		//await this.SendCommand(new SDCPCommand.SDCPCommandTimeperiod(250));
		await this.SendCommand(new SDCPCommand.SDCPCommandFileUpload(filename, totalSize, fileMD5, Options && Options.URL ? Options.URL : `http://$\{ipaddr\}:${TemporaryServer ? TemporaryServer.Port : 3000}/${uuid + ".ctb"}`));		
	}	
}

module.exports = SDCPPrinterMQTT;