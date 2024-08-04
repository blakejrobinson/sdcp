# SDCP

A small work-in-progress library providing a nodejs front end to the SDCP. More information [here](https://github.com/cbd-tech/SDCP-Smart-Device-Control-Protocol-V3.0.0/blob/main/SDCP(Smart%20Device%20Control%20Protocol)_V3.0.0_EN.md).

Functionality is provided as both promises and callback depending on your preference. Feel free to contribute if you want to improve or get extra features in.

An example of it being used can be found over on [Github](https://github.com/blakejrobinson/sdcp_testclient).

## Installation

Install it using [npm]:

    npm install sdcp

## Getting a list of printers on the network

You can request the printers on your network broadcast their presence with SDCP.SDCPDiscovery
```js
SDCP.SDCPDiscovery().then((devices) => 
{
	//devices is a list of SDCP.SDCPPrinters
	for (var device of devices)
	{
		console.log(`Printer ${Printer.Name} responded from ${Printer.MainboardIP}`);
	}
});
```

`SDCPDiscovery` can take an optional object parameter:
```js
{
	Timeout: {number=1000} 			//The amount of time to wait for all printers to reply
	Connect: {boolean=false}		//If set to true, discover will also connect to all V3.0.0+ printers
	Callback: {function} 			//An optional callback that is called every time a printer is added.
}
```

## Connecting to and communicating with a printer

Once you know your printers, you can connect to them in one of two ways:

Using SDCPDiscovery. This will handle the correct SDCPPrinter type for you and return an object you can use.
```js
SDCP.SDCPDiscovery.Connect("10.1.1.113").then((Printer)=>
{
	console.log(Printer);
});
```
You can also create your own SDCPPrinterWS/SDCPPrinterUDP (depending on protocol type):
```js
var Printer = new SDCP.SDCPPrinterWS();
Printer.Connect("10.1.1.113").then(()=>
{
	console.log(Printer);
});
```

Note that you need to use the correct SDCPPrinter type for the respective protocol version. `V3.0.0` and above should use the websocket (`SDCPPrinterWS`) class. Below `V3.0.0` should use the USB (`SDCPPrinterUDB` or `SDCPPrinterMQTT`) classes.

Note that functionality is not yet parallel between the two protocols. Some functions may fail with the error **Not implemented**.

## Remembering printers

Note that if the printer properties are not supplied on SDCPPrinter's construction (Id, MainboardId, etc.) then a broadcast is pinged to the printer to retrieve them.

You can provide the full details of a printer in the constructor:
```js
var Printer = new SDCP.SDCPPrinterWS({
	Id: "{id}",
	Name: "Saturn 4 Ultra",
	MachineName: "Saturn 4 Ultra",
	BrandName: "ELEGOO",
	MainboardIP: "{ip}",
	MainboardID: "{mainboard id}}",       
	ProtocolVersion: "V3.0.0",
	FirmwareVersion: "V1.2.1"
});
```
or you can retrieve this information from an existing SDCPPrinter (made via Discovery or Connect)
```js
var Printer = new SDCP.SDCPPrinterWS();
Printer.Connect("10.1.1.113").then(()=>
{
	var PrinterDetails = Printer.toJSON();
});
```
```js
{
	Id: "{id}",
	Name: "Saturn 4 Ultra",
	MachineName: "Saturn 4 Ultra",
	BrandName: "ELEGOO",
	MainboardIP: "{ip}",
	MainboardID: "{mainboard id}}",       
	ProtocolVersion: "V3.0.0",
	FirmwareVersion: "V1.2.1"
}
```

It might be an idea to store the properties of the printers in some form of address-book database rather than retrieving them each time you connect.

A very basic address book management system `SDCP.SDCPAddressBook` is included. An example of it's use:
```js
const SDCP = require('sdcp');
const AddressBook = require('sdcp/SDCPAddressBook.js');

if (!AddressBook.Printers.length)
	SDCP.SDCPDiscovery().then(devices=>
	{
		AddressBook.Add(devices);
		AddressBook.Save().catch(err=>console.log(`Error saving address book: ${err}`));
		AddressBook.Printers.forEach(p=>
		{
			p.Connect().catch(err=>console.log(`Could not connect to ${p.MainboardIP}: ${err.message}`));	
		});
	});
else
	AddressBook.Printers.forEach(p=>
	{
		p.Connect().catch(err=>console.log(`Could not connect to ${p.MainboardIP}: ${err.message}`));
	});
```

## Interacting with Printers

Printers are event emiters and will emit the following events:
- `connected` - When connected to the printer
- `disconnected` - When disconnected from the printer
- `reconnected` - When reconnected to the printer (`connect` is also sent)
- `notice` - when there is a notice
- `error` - When there is an unsolicited error
- `status` - When an unsolicted status update is received
- `attributes` - When an unsolicted attributes update is received
- `message` - When a websocket message is received that is currently not parsed

```js
Printer.Connect().then(()=>
{
	["notice", "status", "attributes"].forEach(type=>Printer.on(type, (event)=>
	{
		console.log(`\n${type.toUpperCase()}:`);
		console.log(event);
	}));
});
```

The following commands are also wrapped up by the SDCPPrinter class:

#### `GetStatus ([Cache=false])`
Get the current status of the printer. If `cache` is true, uses the last unsolicited cached status.
```js
Printer.Connect().then(()=>
{
	Printer.GetStatus().then((status)=>
	{
		console.log(status);
	});
});
```

#### `GetAttributes ([Cache=false])`
Get the current attributes of the printer. If `cache` is true, uses the last unsolicited cached attributes.
```js
Printer.Connect().then(()=>
{
	Printer.GetAttributes().then((attributes)=>
	{
		console.log(attributes);
	});
});
```

#### `Start (File, Layer)`
Start printing the file `File` (beginning from layer `Layer`). Layer will default to 0.
```js
var Printer = new SDCP.SDCPPrinter();
Printer.Connect("10.1.1.113").then(()=>
{
	Printer.Start("Testing.ctb").then(()=>
	{
		console.log("Print started");
	}
});
```

#### `Pause ()`
Pause the printer's current print.
```js
var Printer = new SDCP.SDCPPrinter();
Printer.Connect("10.1.1.113").then(()=>
{
	Printer.Pause().then(()=>
	{
		console.log("Print paused");
	}
});
```

#### `Stop ()`
Stop the printer's current print.
```js
var Printer = new SDCP.SDCPPrinter();
Printer.Connect("10.1.1.113").then(()=>
{
	Printer.Stop().then(()=>
	{
		console.log("Print stopped");
	}
});
```


#### `GetFiles (Path="usb")` *(not currently supported in <V3.0.0)*
Retrieve a list of files from a path on the printer. Returns an array of Objects that match the spec of the API (type `0` is a folder, type `1` is a file).
```js
var Printer = new SDCP.SDCPPrinter();
Printer.Connect("10.1.1.113").then(()=>
{
	Printer.GetFiles("/usb").then((files)=>
	{
		console.log(files);
	});
});
```
```js
[
  { name: '/usb/old', type: 0 },
  { name: '/usb/case_bottombig_b_2024_0409_1714.ctb', type: 1 },
  { name: '/usb/case_topc_2024_0411_2048.ctb', type: 1 },
  { name: '/usb/Casetest2_2024_0411_2355.ctb', type: 1 },
  { name: '/usb/zeroshield_2024_0418_0327.ctb', type: 1 },
  { name: '/usb/EWJmars.ctb', type: 1 },
  { name: '/usb/EWJ_2024_0512_0455.ctb', type: 1 },
]
```

#### `DeleteFilesFolders (Files, Folders)` *(not currently supported in <V3.0.0)*
Delete a provided selection of files or folders. Files/folders can be `undefined` (don't delete any of that type), a single entry `"test.ctb"` or an array `["folder", "folder"]`.
```js
Printer.Connect().then(()=>
{
	Printer.DeleteFilesFolders(undefined, "/usb/myfolder").then(()=>
	{
		console.log("Deleted files");
	}).catch((err)=>
	{
		console.error(err);
	});
});
```

#### `DeleteFiles (Files)` *(not currently supported in <V3.0.0)*
Identical to the previous function, though purely for deleting files.
```js
Printer.Connect().then(()=>
{
	Printer.DeleteFiles("/usb/myfile.ctb").then(()=>
	{
		console.log("Deleted files");
	}).catch((err)=>
	{
		console.error(err);
	});
});
```

#### `GetHistoricalTasks (Expand=false)` *(not currently supported in <V3.0.0)*
Retrieve a historical list of tasks from the printer based on what it has printed. If `Expand` is false it will return a list of task-id strings. If `Expand` is true it returns an object of tasks (each taskId is a key)
```js
Printer.Connect().then(()=>
{
	Printer.GetHistoricalTasks(false).then((tasks)=>
	{
		console.log(`There were ${tasks.length} tasks`)
		console.log(tasks);
	});
});
```
```js
There were 2 tasks
[
  '1bb70506-4ad7-11ef-90e7-34a6ef373773',
  'b7f4c2f2-4aa3-11ef-ba60-34a6ef373773'
]
```
```js
Printer.Connect().then(()=>
{
	Printer.GetHistoricalTasks(true).then((tasks)=>
	{
		for (task in tasks)
		{
			console.log(tasks[task]);
		}
	});
});
```
```js
{
	Thumbnail: {...},
	TaskName:  {...},
	BeginTime: 2024-07-25T11:16:18.000Z,
	EndTime: 2024-07-25T14:55:11.000Z,
	TaskStatus: 1,
	SliceInformation: {
		...
	},
	TaskId: '1bb70506-4ad7-11ef-90e7-34a6ef373773',
	...
}

{
	Thumbnail: {...},
	TaskName:  {...},
	BeginTime: 2024-07-25T11:16:18.000Z,
	EndTime: 2024-07-25T14:55:11.000Z,
	TaskStatus: 1,
	SliceInformation: {
		...
	},
	TaskId: 'b7f4c2f2-4aa3-11ef-ba60-34a6ef373773',
	...
}		
```

#### `GetHistoricalTaskDetails (TaskId)` *(not currently supported in <V3.0.0)*
Similar to above, but will retrieve the full details of a single (or multiple) tasks based on the ids. TaskId can be a `string` or an array of `string`s.
```js
Printer.Connect().then(()=>
{
	Printer.GetHistoricalTaskDetails('1bb70506-4ad7-11ef-90e7-34a6ef373773').then((task)=>
	{
		console.log(task);	//Returns a single object
	});
	Printer.GetHistoricalTaskDetails(['1bb70506-4ad7-11ef-90e7-34a6ef373773','b7f4c2f2-4aa3-11ef-ba60-34a6ef373773']).then((task)=>
	{
		console.log(task);	//Returns an collection of objects
	});
});
```
)

#### `SetTimelapse (Enabled)` *(not currently supported in <V3.0.0)*
Toggle the timelapse feature on and off
```js
Printer.Connect().then(()=>
{
	Printer.SetTimelapse(true).then(()=>
	{
		console.log("Timelapse enabled");
	});
});
```

#### `SetVideoStream (Enabled)` *(not currently supported in <V3.0.0)*
Toggle the video-stream feature on and off. If turned on, it will return the URL of the RTSP videostream. Most devices will have a limit for how many streams can be active. I have not investigated this enough to know how it works.
```js
Printer.Connect().then(()=>
{
	Printer.SetVideoStream(true).then((URL)=>
	{
		console.log(`Videostream enabled at ${URL}`);
	});
});
```
#### At some point I'll be fully implementing this inside SDCP

## File uploading
Files can be uploaded using `SDCPPrinter.UploadFile()`

#### `UploadFile (File, [Options])`
`File` points to a local file, `Options` can be used to enable/disable verification or have a progress callback called each chunk:
```js
Printer.Connect().then(()=>
{
	Printer.UploadFile("C:\\Flame_Defender_Bust_2_2024_0522_2328.ctb", 
	{
		//Called pre-upload and every 1mb uploaded
		ProgressCallback: (progress)=>
		{
			console.log(progress);
		}
	}).then((result)=>
	{
		console.log(result);
	});
});
```
```js
{Status: 'Preparing','S-File-MD5': 'fd8c8c66c3ae82f1be0b544d1'...}
{Status: 'Uploading','S-File-MD5': 'fd8c8c66c3ae82f1be0b544d1'...}
...
{Status: 'Uploading','S-File-MD5': 'fd8c8c66c3ae82f1be0b544d1'...}
{Status: 'Complete', 'S-File-MD5': 'fd8c8c66c3ae82f1be0b544d1'...}
```
`Options` currently supports:
```js
{
	Verification:     {boolean} 			//Whether to verify the upload
	ProgressCallback: {function(progress)}	//A callback that's called every 1mb
	URL: 			  {string}				//A custom URL for MQTT servers. Leave blank for built-in HTTP server
}
```

## Custom commands and handling
`SDCPPrinter.SendCommand` can be used to send commands not yet wrapped. Here is an example of sending the GetFiles command without using the wrapped function:
```js
Printer.SendCommand({
	Data: {
		Cmd: 258,
		Data: {
			Url: "/usb"
		},
		From: 0
	}
}).then((response)=>
{
	console.log(response);
});

//The above can be shorthanded to
//Printer.SendCommand(258, {Url: "/usb"}).then((response)=>
```
```js
{
  Id: '{id}',
  Data: {
    Cmd: 258,
    Data: { Ack: 0, FileList: [Array] },
    RequestID: '80f81fdf8e687f487c5bc5c2b4ed6074',
    MainboardID: '{mainboardid}',
    TimeStamp: 1722022860
  },
  Topic: 'sdcp/response/{mainboardid}}'
}
```
SendCommand can be used in various ways:
- `SendCommand (CommandId)` - Send an integer command.
- `SendCommand (CommandId, {Parameter: Value})` - Send an integer command with parameters
- `SendCommand ({Data: {Cmd: ...}})` - Define a full custom send packet to send as an Object
- `SendCommand (SDCPCommand*)` - Send a custom defined SDCPCommand (or extended classes)

It's probably better to extend the SDCPCommand classes with your own entries to expand the handling. See the wrappers in `SDCPPrinter.js` for examples.

**Be careful** when sending custom commands. I have crashed my printer by sending unexpected data.

## Always on connections
Both `SDCPPrinterWS` and `SDCPPrinterMQTT` have support for for 'always on' connections. Simply set the `AutoReconnect` property to `true` (or a `number` indicating how long in Ms to wait between retries).
```js
Printer.AutoReconnect = true;		//Auto re-connect
Printer.AutoReconnect = 5000;		//Auto re-connect every 5 seconds
```

---

## Updates

#### 0.5.4 ####
- Further consistency for `SDCPPrinterMQTT` (PrintInfo.Status). Print info status is now modified to match V3.0.0 SDCP,
- Note that the .Broadcast UDP responses are not corrected (yet),
- Various tweaks and fixes

#### 0.5.3 ####
- `AutoReconnect` fix for constructors, 
- Improve autoreconnect again (Callback was missing for delayed connect),
- `SDCPDiscovery` options made consistent case-wise (starting with capitals - apologies),
- `SDCPCommandFileCancelUpload` command added to prebuild commands (couldn't seem to get it to work, but adding it),
- Various tweaks and fixes

#### 0.5.0 ####
- Fix for `SDCPPrinterMQTT` not sending updates on FileUpload,
- `SDCPPrinterMQTT` now uses built in simple HTTP server to serve file,
- Various tweaks and fixes

#### 0.4.9 ####
- Improved autoreconnect feature for MQTT and WS SDCPPrinters. AutoReconnect is now off by default
- Various tweaks and fixes

#### 0.4.8 ####
- Changed UDP, MQTT and WS GetStatus to be consistent. Sorry for the structure change but this'll make it much easier in the long run ~_~
- Various tweaks and fixes

#### 0.4.7
- UploadFile callbacks made consistent between MQTT and WS SDCPPrinters,
- Further support for older V1.0.0 MQTT based models (Mars 4 Ultra etc.),
- Built in MQTT server and `SDCPPrinterMQTT` class to allow for V1.0.0 connection,
- File upload on v1.0.0 (requires HTTP server)
- Various tweaks and fixes

#### 0.4.1
- Initial support for older V1.0.0 UDP based models
- Address book handling class,
- SDCPDiscovery options provides callback for each printer found,
- Various tweaks and fixes

#### 0.3.7
- `Start`, `Pause` and `Stop` function wrappers added to `SDCPPrinter` class,
- Various tweaks and fixes

#### Working on
- Built in camera stream/screenshot handling
- Wrappers for timelapse downloading