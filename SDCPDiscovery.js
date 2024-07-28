const SDCPPrinter    = require('./SDCPPrinter.js');
const dgram = require('dgram');
const debug = false;

/**
 * @typedef {import('./SDCPPrinter.js')} SDCPPrinter

/**
 * Discover SDCP devices on the network
 * @param {{timeout: number, connect: bool, cbperprinter: bool}|number} [Options] - Options for the discovery process or timeout value
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
		return new Promise((resolve,reject) => {SDCPDiscovery(Options, (err,devices) => {if (err) return reject(err); resolve(devices);});});

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
			Callback(undefined, Devices);

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
		if (PrinterInfo.Data.Attributes) PrinterInfo.Data.Attributes.Id = PrinterInfo.Id;
		var PrinterType = SDCPDiscovery.PrinterType(PrinterInfo.Data && PrinterInfo.Data.Attributes ? PrinterInfo.Data.Attributes : PrinterInfo.Data);
		Devices.push(new PrinterType(PrinterInfo.Data && PrinterInfo.Data.Attributes ? PrinterInfo.Data.Attributes : PrinterInfo.Data ? PrinterInfo.Data : PrinterInfo));
		if (typeof Options.callback === "function")
			Options.callback(Devices[Devices.length-1]);
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
function SDCPConnect(MainboardIP, PrinterType, Callback)
{
	if (typeof PrinterType === 'function') {Callback = PrinterType; PrinterType = SDCPPrinter;}
	if (typeof PrinterType !== 'function') PrinterType = SDCPPrinter;

	if (typeof Callback !== 'function') 
		return new Promise((resolve,reject) => {SDCPConnect(MainboardIP, function(err,device) {if (err) return reject(err); resolve(device);});});
	var Printer = new PrinterType(MainboardIP);
	Printer.Connect().then(()=>
	{
		Callback(null, Printer);
	}).catch((err) => Callback(err));
}

const SDCPPrinterUDP  = require('./SDCPPrinterUDP.js');
const SDCPPrinterMQTT = require('./SDCPPrinterMQTT.js');
const SDCPPrinterWS   = require('./SDCPPrinterWS.js');
/**
 * Return the correct printer handler to use
 * @param {Object} about 
 * @returns {SDCPPrinter} - The printer handler to use
 */
function PrinterType(about)
{
	if (about && about.ProtocolVersion === "V3.0.0") return SDCPPrinterWS;
	if (about && about.ProtocolVersion === "V1.0.0") return SDCPPrinterMQTT;
	return SDCPPrinter;
}

SDCPDiscovery.Connect     = SDCPConnect;
SDCPDiscovery.PrinterType = PrinterType;

module.exports = SDCPDiscovery;