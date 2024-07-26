const SDCPConstants = require('./Constants');
const SDCPCommand  = require('./SDCPCommand');
const EventEmitter = require('events');
const WebSocket = require('ws');
const dgram = require('dgram');
const SDCP = require('.');

const debug = true;

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
		for (var key in Config) this[key] = Config[key];
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
			return new Promise((resolve,reject) => {this.Connect(MainboardIP, function(err) {if (err) return reject.call(err); resolve();});});

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
			this.emit('error', error);
			if (Callback) Callback.call(Printer, error);
			Callback = undefined;
		});
	
		this.#Websocket.on('close', () => 
		{
			if (debug) console.log(`Disconnected from ${this.ip}:${this.port}`);
			this.emit('disconnected');
			if (this.#AutoReconnect !== false)
				setTimeout(this.Connect(), 5000);
		});		
	}

	/**
	 * @param {string} [MainboardIP] - The IP address of the printer to connect to. If left blank it will use the MainboardIP property
	 * @param {function(Error?): void} [Callback] - Callback function to be called when the connection is established
	 * @returns {Promise<void>} - Promise that resolves when the connection is established
	 */	
	Broadcast(MainboardIP, Callback)
	{
		if (Callback === undefined)
			return new Promise((resolve,reject) => {this.Broadcast(MainboardIP, (err) => {if (err) return reject(err); resolve();});});

		if (typeof MainboardIP === 'function') {Callback = MainboardIP; MainboardIP = undefined;}
		if (MainboardIP === undefined) MainboardIP = this.MainboardIP;
		if (MainboardIP === undefined)
			return Callback(new Error('No IP address provided'));

		const client = dgram.createSocket('udp4');
		const discoveryMessage = 'M99999';
		
		client.bind(() => client.setBroadcast(true));
		client.on('message', (msg, rinfo) => 
		{
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
			Callback(undefined);
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
		if (!this.#Websocket)
			Callback(new Error('Not connected to printer'));
		if (typeof Command === 'number') Command = {Data: {Cmd: Command}};

		const crypto = require('crypto');
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
	 * Get the status of the printer
	 * @param {function(Error?, Object): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	GetStatus(Callback)
	{
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.GetStatus((err,status) => {if (err) return reject(err); resolve(status);});});

		this.SendCommand(new SDCPCommand.SDCPCommandStatus).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error getting status'));
			Callback(undefined, response.Status);
		}).catch(err=>Callback(err));
	}

	/**
	 * Get the attributes of the printer
	 * @param {function(Error?, Object): void} [Callback] - Callback function to be called when the command is complete
	 * @returns {Promise<Object>} - Promise that resolves with the response from the printer
	 */
	GetAttributes(Callback)
	{
		if (Callback === undefined) 
			return new Promise((resolve,reject) => {this.GetAttributes((err,status) => {if (err) return reject(err); resolve(status);});});

		this.SendCommand(new SDCPCommand.SDCPCommandAttributes).then((response) =>
		{
			if (response.Data && response.Data.Data && response.Data.Data.Ack !== 0)
				return Callback(new Error('Error getting attributes'));
			Callback(undefined, response.Attributes);
		}).catch(err=>Callback(err));
	}	

	/**
	 * Get a list of files from the printer
	 * @param {string} Path - The path to get the files from
	 * @param {function(Error?, Object[]): void} [Callback] - Callback function to be called when the command is complete
	 */
	GetFiles(Path, Callback)
	{
		if (Callback === undefined) 
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