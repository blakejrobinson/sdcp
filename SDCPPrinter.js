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
 * Represents an SDCP (Simple Device Control Protocol) Printer
 * @class
 */
class SDCPPrinter extends EventEmitter
{
	/** The Id */
	Id = undefined;
	/** The MAC address of the printer */
	Name = undefined;
	/** The machine name of the printer */
	MachineName = undefined;
	/** The brand name of the printer */
	BrandName = undefined;
	/** The IP address of the printer */
	MainboardIP = undefined;
	/** The ID of the printer */
	MainboardID = undefined;
	/** The protocol version of the printer */
	ProtocolVersion = undefined;
	/** The firmware version of the printer */
	FirmwareVersion = undefined;
	/** Connected? */
	Connected = false;

	/**
	 * Create a new SDCPPrinter instance
	 * @param {Object} Config - The configuration object for the printer. If a string is provided, it is assumed to be the IP address of the printer
	 * @param {string} Config.Name - The MAC address of the printer
	 * @param {string} Config.MachineName - The machine name of the printer
	 * @param {string} Config.BrandName - The brand name of the printer
	 * @param {string} Config.MainboardIP - The IP address of the printer
	 * @param {string} Config.MainboardID - The ID of the printer
	 * @param {string} Config.ProtocolVersion - The protocol version of the printer
	 * @param {string} Config.FirmwareVersion - The firmware version of the printer
	 */
	constructor(Config)
	{
		super();
		if (typeof Config === 'string') Config = {MainboardIP: Config};
		if (typeof Config !== 'object') Config = {};
		for (var key in Config) 
			if (key !== "AutoReconnect") 
				this[key] = Config[key];
	}

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
		Callback(new Error('Not implemented'));
	}

	/**
	 * @param {string} [MainboardIP] - The IP address of the printer to connect to. If left blank it will use the MainboardIP property
	 * @param {Object|number} [Options] - Options for the broadcast (number is the timeout)
	 * @param {function(Error?): void} [Callback] - Callback function to be called when the connection is established
	 * @returns {Promise<void>} - Promise that resolves when the connection is established
	 */
	Broadcast(MainboardIP, Options, Callback)
	{
		if (typeof Options === 'function') {Callback = Options; Options = undefined;}
		if (typeof Options === 'number') Options = {timeout: Options};
		if (Options === undefined) Options = {};

		if (Callback === undefined)
			return new Promise((resolve,reject) => {this.Broadcast(MainboardIP, Options, (err, Results) => {if (err) return reject(err); resolve(Results);});});

		if (typeof MainboardIP === 'function') {Callback = MainboardIP; MainboardIP = undefined;}
		if (MainboardIP === undefined) MainboardIP = this.MainboardIP;
		if (MainboardIP === undefined)
			return Callback(new Error('No IP address provided'));

		var timeoutWatch = undefined, timedOut = false;
		if (Options.timeout !== undefined)
		{
			timeoutWatch = setTimeout(() =>
			{
				return Callback(new Error('Timeout'));
				timedOut = true;
			}, Options.timeout);
		}

		const client = dgram.createSocket('udp4');
		const discoveryMessage = 'M99999';

		client.bind(() => client.setBroadcast(true));
		client.on('message', (msg, rinfo) =>
		{
			if (timedOut) return;
			if (timeoutWatch) clearTimeout(timeoutWatch);

			if (debug) console.log(`    Received response from ${rinfo.address}:${rinfo.port}`);
			if (debug) console.log(`    ${msg.toString()}`);

			var PrinterInfo = {};
			try
			{
				PrinterInfo = JSON.parse(msg.toString());
			} catch(err)
			{
				if (debug) console.error('    Error parsing JSON:', err);
				return Callback(err);
			}

			if (PrinterInfo.Data.Attributes && !PrinterInfo.Data.Attributes.MainboardIP)
				PrinterInfo.Data.Attributes.MainboardIP = rinfo.address;

			PrinterInfo.Data.Id = PrinterInfo.Id;
			for (var key in PrinterInfo.Data) this[key] = PrinterInfo.Data[key];
			Callback(undefined, PrinterInfo);
			//client.close();
		});

		if (debug) console.log('Broadcasting discovery message...');
		client.send(discoveryMessage, 3000, MainboardIP, (err) =>
		{
			if (err)
			{
				if (debug) console.error('    Error broadcasting message:', err);
			}
			else
			{
				if (debug) console.log('    Discovery message broadcast successfully');
			}
		});
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

		Callback(new Error('Not implemented'));
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

		this.SendCommand(new SDCPCommand.SDCPCommandAttributes).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error getting attributes'));
			Callback(undefined, response.Attributes);
		}).catch(err=>Callback(err));
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

		if (File === undefined)
			return Callback(new Error('No file provided'));

		this.SendCommand(new SDCPCommand.SDCPCommandStart(File, Layer)).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error starting print'));
			Callback(undefined);
		}).catch(err=>Callback(err));
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

		this.SendCommand(new SDCPCommand.SDCPCommandPause()).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error pausing print'));
			Callback(undefined);
		}).catch(err=>Callback(err));
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

		this.SendCommand(new SDCPCommand.SDCPCommandStop()).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error stopping print'));
			Callback(undefined);
		}).catch(err=>Callback(err));
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

		this.SendCommand(new SDCPCommand.SDCPCommandFileList(Path)).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error getting file list'));
			if (!response.Data || !response.Data.Data || !response.Data.Data.FileList)
				return Callback(new Error('No file list received'));
			Callback(undefined, response.Data.Data.FileList);
		}).catch(err=>Callback(err));
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

		if (Files === undefined) Files = [];
		if (Folders === undefined) Folders = [];
		if (Array.isArray(Files) === false) Files = [Files];
		if (Array.isArray(Folders) === false) Folders = [Folders];

		this.SendCommand(new SDCPCommand.SDCPCommandBatchDeleteFiles(Files, Folders)).then((response) =>
			{
				if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
					return Callback(new Error('Error deleting file/folder list'));
				if (response.Data && response.Data.Data && response.Data.Data.ErrData)
					return Callback(new Error('Error deleting file/folder list'), response.Data.Data.ErrData);
				Callback(undefined);
			}).catch(err=>Callback(err));
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

		this.SendCommand(new SDCPCommand.SDCPCommandHistoricalTasks()).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error getting historical tasks'));
			if (!response.Data || !response.Data.Data || !response.Data.Data.HistoryData)
				return Callback(new Error('No historical tasks received'));
			if (!Expand)
				return Callback(undefined, response.Data.Data.HistoryData);
			this.GetHistoricalTaskDetails(response.Data.Data.HistoryData, Callback);
		}).catch(err=>Callback(err));
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

		if (TaskId === undefined)
			return Callback(new Error('No task ID provided'));

		this.SendCommand(new SDCPCommand.SDCPCommandTaskDetails(TaskId)).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error getting historical tasks'));
			if (!response.Data || !response.Data.Data || !response.Data.Data.HistoryDetailList)
				return Callback(new Error('No historical tasks received'));
			var Tasks = {};
			response.Data.Data.HistoryDetailList.forEach((task) =>
			{
				task.BeginTime = new Date(task.BeginTime * 1000);
				task.EndTime   = new Date(task.EndTime   * 1000);
				if (task.TimeLapseVideoUrl !== undefined) 	task.TimeLapseVideoUrl = `http://${this.MainboardIP}${task.TimeLapseVideoUrl}`;
				if (task.TaskName !== undefined)			task.TaskUrl           = `http://${this.MainboardIP}${task.TaskName}`;
				if (task.TaskStatus !== undefined)			task.TaskStatusText    = SDCPConstants.SDCP_PRINT_TASKSTATUS_DESCRIPTIONS[task.TaskStatus];
				if (task.ErrorStatusReason !== undefined) 	task.ErrorStatusReasonText = SDCPConstants.SDCP_PRINT_TASKERROR_DESCRIPTIONS[task.ErrorStatusReason];
				Tasks[task.TaskId] = task;
			});
			if (!Array.isArray(TaskId))
				return Callback(undefined, Tasks[TaskId]);
			Callback(undefined, Tasks);
		});
	}

	/**
	 * Toggle the timelapse on the printer
	 * @param {boolean} Enable - Whether or not to enable the timelapse
	 * @param {function(Error?, Object): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	SetTimelapse(Enable, Callback)
	{
		if (Callback === undefined)
			return new Promise((resolve,reject) => {this.SetTimelapse(Enable, (err,response) => {if (err) return reject(err); resolve(response);});});

		this.SendCommand(new SDCPCommand.SDCPCommandTimelapse(Enable)).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error setting timelapse'));
			Callback(undefined, response);
		}).catch(err=>Callback(err));
	}

	/**
	 * Toggle the video stream on the printer
	 * @param {boolean} Enable - Whether or not to enable the timelapse
	 * @param {function(Error?, [string]): void} [Callback] - Callback function to be called when the command is complete. Provides the URL to the video stream if enabled
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	SetVideoStream(Enable, Callback)
	{
		if (Callback === undefined)
			return new Promise((resolve,reject) => {this.SetVideoStream(Enable, (err,response) => {if (err) return reject(err); resolve(response);});});

		this.SendCommand(new SDCPCommand.SDCPCommandVideoStream(Enable)).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error(response.Data.Data.Ack === 1 ? 'Exceeded maximum number of video streams'
										: response.Data.Data.Ack === 2 ? 'Camera does not exist'
										: 'Unknown error'));
			Callback(undefined, response && response.Data && response.Data.Data ? response.Data.Data.VideoUrl : undefined);
		}).catch(err=>Callback(err));
	}

	/**
	 * Cancel the current upload
	 * @param {string} Uuid - The Uuid of the upload
	 * @param {string} FileName - The name of the file being uploaded
	 * @param {function(Error?): void} [Callback] - Callback function to be called when the command is complete
	 */
	CancelUpload(Uuid, File, Callback)
	{
		if (Callback === undefined)
			return new Promise((resolve,reject) => {this.CancelUpload(Uuid, File, (err) => {if (err) return reject(err); resolve();});});

		this.SendCommand(new SDCPCommand.SDCPCommandFileCancelUpload(Uuid, File)).then((response) =>
			{
				if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
					return Callback(new Error(response.Data.Data.Ack === SDCPConstants.SDCP_FILE_TRANSFER_ACK.NOT_TRANSFER ? 'Not currently transferring'
											: response.Data.Data.Ack === SDCPConstants.SDCP_FILE_TRANSFER_ACK.NOT_FOUND    ? 'File not found'
											: response.Data.Data.Ack === SDCPConstants.SDCP_FILE_TRANSFER_ACK.CHECKING     ? 'Printer already checking'
											: 'Unknown error'));
				Callback(undefined, response);
			}).catch(err=>Callback(err));
	}


	/**
	 * JSON representation of the printer
	 * @returns {Object}
	 */
	toJSON()
	{
		return {Id: this.Id,
				Name: this.Name,
				MachineName: this.MachineName,
				BrandName: this.BrandName,
				MainboardIP: this.MainboardIP,
				MainboardID: this.MainboardID,
				ProtocolVersion: this.ProtocolVersion,
				FirmwareVersion: this.FirmwareVersion
			};
	}
}

module.exports = SDCPPrinter;