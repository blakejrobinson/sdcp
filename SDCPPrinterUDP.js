const SDCPConstants = require('./Constants');
const SDCPCommand  = require('./SDCPCommand');
const EventEmitter = require('events');
const dgram = require('dgram');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const debug = false;
const UDP_UPDATE_RATE = 500;		//ms
/**
 * Represents an SDCP (Simple Device Control Protocol) Printer controlled via Websockets
 * @class
 */
class SDCPPrinterUDP extends require("./SDCPPrinter")
{
	/** Whether or not it should try to autoreconnect */
	#_AutoReconnect = true;
	/** Request queue */
	#Requests = [];
	/** Route updates (statues and attributes) (FIFO queue) */
	#UpdateRoute = [];
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

		//Requires protocol != V3.0.0
		if (this.ProtocolVersion === 'V3.0.0')
			return Callback(new Error('Printer does not support UDP control'));

		//UDP update loop
		var Printer = this;
		var EverConnected = false, FailedAttempts = 0;
		var UpdatePrinter = function()
		{
			//Request an update from the printer
			this.Broadcast(MainboardIP, {timeout: 500}, (err, status) =>
			{
				//if (err) console.log(err);
				if (err)
				{
					FailedAttempts++;
					if (FailedAttempts < 5)
						setTimeout(UpdatePrinter.bind(this), UDP_UPDATE_RATE);
					else
					{
						this.emit('disconnected');
						if (typeof Callback === 'function')
							Callback(new Error('Failed to connect to printer'));
						Callback = undefined;

						if (Printer.#_AutoReconnect === true)
							setTimeout(UpdatePrinter.bind(this), UDP_UPDATE_RATE);
					}

					return this.Connected = false;
				}
				if (!EverConnected === false)
					this.emit('connected');
				this.Connected = true;
				if (typeof Callback === 'function')
					Callback.call(Printer);
				Callback = undefined;

				//Status update?
				if (status.Data && status.Data.Status)
				{
					if (Printer.#UpdateRoute.length > 0 && Printer.#UpdateRoute[0].Type === 'status')
					{
						if (typeof Printer.#UpdateRoute[0].Callback === "function")
							Printer.#UpdateRoute[0].Callback(undefined, status.Data.Status);
						Printer.#UpdateRoute.shift();
					}
					if(JSON.stringify(status.Data.Status) !== Printer.#LastStatus)
					{
						if (Printer.#LastStatus !== undefined) this.emit('status', status.Data.Status);
						Printer.#LastStatus = JSON.stringify(status.Data.Status);
					}
				}

				//Attribute update?
				if (status.Data && status.Data.Attributes)
				{
					if (Printer.#UpdateRoute.length > 0 && Printer.#UpdateRoute[0].Type === 'attributes')
					{
						if (typeof Printer.#UpdateRoute[0].Callback === "function")
							Printer.#UpdateRoute[0].Callback(undefined, status.Data.Attributes);
						Printer.#UpdateRoute.shift();
					}
					if (JSON.stringify(status.Data.Attributes) !== Printer.#LastAttributes)
					{
						if (Printer.#LastAttributes !== undefined) this.emit('attribute', status.Data.Attributes);
						Printer.#LastAttributes = JSON.stringify(status.Data.Attributes);
					}
				}

				//Connection tracking
				EverConnected = true;
				FailedAttempts = 0;

				//Check for changes to attributes or events
				//if (status && status.Status);

				setTimeout(UpdatePrinter.bind(this), UDP_UPDATE_RATE);
			});
		}.bind(this);
		UpdatePrinter();
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
		if (!this.Connected)
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
		if (debug) console.log(JSON.parse(JSON.stringify(Command), undefined, "\t"));
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

		if (Cached === true && this.#LastStatus === undefined)
			return Callback(undefined, this.#LastStatus);

		//We want one the next time it comes in
		this.#UpdateRoute.push({Type: 'status', Callback: Callback});
		this.Broadcast(this.MainboardIP, {timeout: 500});
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

		if (Cached === true && this.#LastAttributes === undefined)
			return Callback(undefined, this.#LastAttributes);

		//We want one the next time it comes in
		this.#UpdateRoute.push({Type: 'attributes', Callback: Callback});
		this.Broadcast(this.MainboardIP, {timeout: 500});
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
}

module.exports = SDCPPrinterUDP;