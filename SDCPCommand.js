const SDCPConstants = require('./Constants');
const debug = false;

/**
 * Represents an SDCP (Simple Device Control Protocol) Command
 * @class SDCPCommand
 */
class SDCPCommand
{
	/** The Id */
	Id = undefined;
	/** The data structure */
	Data = 
	{
		Cmd: undefined, 
		Data: {},
		RequestID: undefined,
		MainboardID: undefined,
		Timestamp: parseInt(Date.now()/1000),
		From: global.SDCPCommandFrom || SDCPConstants.SDCP_FROM.PC
	};
	/** The topic */
	Topic = undefined;

	/**
	 * Convert to JSON string
	 * @returns {string} - JSON string
	 */
	toJSON()
	{
		return {Id: this.Id, Data: this.Data, Topic: this.Topic};
	}
}

class SDCPCommandStatus extends SDCPCommand
{
	constructor()
	{
		super();
		this.Data.Cmd = 0;
	}
}
class SDCPCommandAttributes extends SDCPCommand
{
	constructor()
	{
		super();
		this.Data.Cmd = 1;
	}
}
class SDCPCommandStart extends SDCPCommand
{
	/** 
	 * Start printing a file
	 * @param {string} Filename - The filename to print
	 * @param {number} [Startlayer] - The layer to start printing from
	 */
	constructor(Filename, Startlayer=0)
	{
		if (typeof Filename !== "string") throw new Error("Filename must be a string");

		super();
		this.Data.Cmd = 128;
		this.Data.Data = {Filename: Filename, Startlayer: Startlayer};
	}
}
class SDCPCommandPause extends SDCPCommand
{
	constructor()
	{
		super();
		this.Data.Cmd = 129;
	}
}
class SDCPCommandStop extends SDCPCommand
{
	constructor()
	{
		super();
		this.Data.Cmd = 130;
	}
}
class SDCPCommandContinue extends SDCPCommand
{
	constructor()
	{
		super();
		this.Data.Cmd = 131;
	}
}

class SDCPCommandRename extends SDCPCommand
{
	/** 
	 * Start printing a file
	 * @param {string} Name - The new name of the printer
	 */
	constructor(Name)
	{
		if (typeof Name !== "string") throw new Error("Name must be a string");

		super();
		this.Data.Cmd = 192;
		this.Data.Data = {Name: Name};
	}
}

class SDCPCommandFileCancelUpload extends SDCPCommand
{
	/** 
	 * Start printing a file
	 * @param {string} Uuid - The UUID of the upload
	 * @param {string} FileName - The path to file
	 * 
	 */
	constructor(Uuid, FileName)
	{
		super();	
		this.Data.Cmd = 255;
		this.Data.Data = {
			Uuid: Uuid,
			FileName: FileName
		};
	}
}

class SDCPCommandFileUpload extends SDCPCommand
{
	/** 
	 * Start printing a file
	 * @param {string} [Path] - The path to file
	 * @param {number} [Size] - The size of the file
	 * @param {string} [Hash] - The hash of the file
	 * @param {string} [URL] - The URL of the file
	 * 
	 */
	constructor(Path, Size, Hash, URL)
	{
		super();
		this.Data.Cmd = 256;
		this.Data.Data = {
            Check: 		0,
            CleanCache: 1,
            Compress: 	0,
            FileSize: 	Size,
            Filename: 	Path,
            MD5: 		Hash,
            URL: 		URL.toLowerCase().startsWith('http') ? URL : 'http://${ipaddr}:3000/' + URL
        };
	}
}
class SDCPCommandFileList extends SDCPCommand
{
	/** 
	 * Start printing a file
	 * @param {string} [Path] - The path to lits
	 */
	constructor(Path)
	{
		if (typeof Path !== "string" || Path === "") Path = "/"

		super();
		this.Data.Cmd = 258;
		this.Data.Data = {Url: Path};
	}
}
class SDCPCommandBatchDeleteFiles extends SDCPCommand
{
	/** 
	 * Start printing a file
	 * @param {string[]} [FileList] - A list of files to delete
	 * @param {string[]} [FolderList] - A list of folders to delete
	 * 
	 */
	constructor(FileList, FolderList)
	{
		if (FileList === undefined) FileList = []
		if (FolderList === undefined) FolderList = []		
		if (!Array.isArray(FileList)) FileList = [FileList];
		if (!Array.isArray(FolderList)) FolderList = [FolderList];

		super();
		this.Data.Cmd = 259;
		this.Data.Data = {FileList: FileList, FolderList: FolderList};
	}
}

class SDCPCommandHistoricalTasks extends SDCPCommand
{
	constructor()
	{
		super();
		this.Data.Cmd = 320;
	}
}
class SDCPCommandTaskDetails extends SDCPCommand
{
	/**
	 * Get the list of tasks
	 * @param {string[]} TaskIdList - The list of task ids to get details for
	 */
	constructor(TaskIdList)
	{
		if (TaskIdList === undefined) TaskIdList = []
		if (!Array.isArray(TaskIdList)) TaskIdList = [TaskIdList];

		super();
		this.Data.Cmd = 321;
		this.Data.Data = {Id: TaskIdList};
	}
}
class SDCPCommandVideoStream extends SDCPCommand
{
	/**
	 * Toggle whether timelapse is enabled
	 * @param {bool} Enabled - Whether timelapse is enabled
	 */
	constructor(Enabled=true)
	{
		super();
		this.Data.Cmd = 386;
		this.Data.Data = {Enable: Enabled ? 1 : 0};
	}
}
class SDCPCommandTimelapse extends SDCPCommand
{
	/**
	 * Toggle whether timelapse is enabled
	 * @param {bool} Enabled - Whether timelapse is enabled
	 */
	constructor(Enabled=true)
	{
		super();
		this.Data.Cmd = 387;
		this.Data.Data = {Enable: Enabled ? 1 : 0};
	}
}

class SDCPCommandTimeperiod extends SDCPCommand
{
	/**
	 * Toggle whether timelapse is enabled
	 * @param {number} TimePeriod - The time period in milliseconds
	 */
	constructor(TimePeriod=5000)
	{
		super();
		this.Data.Cmd = 512;
		this.Data.Data = {TimePeriod: TimePeriod};
	}
}

module.exports =
{
	SDCPCommand,
	SDCPCommandStatus,
	SDCPCommandAttributes,
	SDCPCommandStart,
	SDCPCommandPause,
	SDCPCommandStop,
	SDCPCommandContinue,
	SDCPCommandRename,
	SDCPCommandFileList,
	SDCPCommandBatchDeleteFiles,
	SDCPCommandHistoricalTasks,
	SDCPCommandTaskDetails,
	SDCPCommandVideoStream,
	SDCPCommandTimelapse,
	SDCPCommandFileUpload,
	SDCPCommandFileCancelUpload,
	SDCPCommandTimeperiod
};