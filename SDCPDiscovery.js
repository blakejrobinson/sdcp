const SDCPPrinter = require('./SDCPPrinter.js');
const dgram = require('dgram');
const debug = false;

/**
 * @typedef {import('./SDCPPrinter.js')} SDCPPrinter

/**
 * Discover SDCP devices on the network
 * @param {{timeout: number, connect: bool}|number} [Options] - Options for the discovery process or timeout value
 * @param {function(Error?, SDCPPrinter[]): void} [Callback] - Callback function to be called when the discovery process is complete
 * @returns {Promise<SDCPPrinter[]>} - Promise that resolves with an array of SDCPPrinter objects
*/
function SDCPDiscovery(Options, Callback)
{
	if (typeof Options === 'function') {Callback = Options; Options = {};}
	if (typeof Options === 'number')   {Options = {timeout: Options};}
	if (typeof Options !== 'object')   {Options = {};}
	if (Options.timeout === undefined) {Options.timeout = 1000;}
	if (Options.connect === undefined) {Options.connect = false;}

	//No callback? Handle this as a promise
	if (!Callback)
		return new Promise((resolve,reject) => {SDCPDiscovery((err,devices) => {if (err) return reject(err); resolve(devices);});});

	const client = dgram.createSocket('udp4');
	const broadcastAddress = '255.255.255.255';
	const discoveryMessage = 'M99999';

	/** @type {SDCPPrinter[]} */
	var Devices = [];
	setTimeout(() =>
	{
		if (debug) console.log('Discovery process complete');
		if (client) client.close();
		if (typeof Callback === "function") 
			Callback(null, Devices);

		//Now connect the printers
		if (Options.connect)
		{
			for (var Printer of Devices)
			{
				if (Printer.ProtocolVersion === "V3.0.0")
					Printer.Connect();
			}
		}
	}, Options.timeout);

	client.bind(() => client.setBroadcast(true));
	client.on('message', (msg, rinfo) => 
	{
		if (debug) console.log(`    Received response from ${rinfo.address}:${rinfo.port}`);
		if (debug) console.log(msg.toString());

		var PrinterInfo = {};
		try
		{
			PrinterInfo = JSON.parse(msg.toString());			
		} catch(err) 
		{
			if (debug) console.error('    Error parsing JSON:', err);
			return;
		}

		if (PrinterInfo.Data.Attributes && !PrinterInfo.Data.Attributes.MainboardIP)
			PrinterInfo.Data.Attributes.MainboardIP = rinfo.address;

		PrinterInfo.Data.Id = PrinterInfo.Id;
		Devices.push(new SDCPPrinter(PrinterInfo.Data && PrinterInfo.Data.Attributes ? PrinterInfo.Data.Attributes : PrinterInfo.Data ? PrinterInfo.Data : PrinterInfo));
		//client.close();
	});

	if (debug) console.log('Broadcasting discovery message...');
	client.send(discoveryMessage, 3000, broadcastAddress, (err) => 
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
 * Connect to a single SDCPPrinter device
 * @param {string} MainboardIP - The IP address of the mainboard
 * @param {function(Error?, SDCPPrinter): void} Callback - Callback function to be called when the connection is complete
 * @returns {Promise<SDCPPrinter[]>} - Promise that resolves with an array of SDCPPrinter objects
 */
function SDCPConnect(MainboardIP, Callback)
{
	if (typeof Callback !== 'function') 
		return new Promise((resolve,reject) => {SDCPConnect(MainboardIP, function(err,device) {if (err) return reject(err); resolve(device);});});
	var Printer = new SDCPPrinter(MainboardIP);
	Printer.Connect().then(()=>
	{
		Callback(null, Printer);
	}).catch((err) => Callback(err));
}

SDCPDiscovery.Connect = SDCPConnect;

module.exports = SDCPDiscovery;