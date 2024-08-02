const fs = require("fs");
const SDCPDiscovery  = require("./SDCPDiscovery");
const SDCPPrinter    = require("./SDCPPrinter");
const debug = false;

class SDCPAddressBook
{
	/** string - The file to save to */
	#addressBookFile = "config.json";
	/** SDCPAddressBookEntry[] - An array of entries*/
	#AddressBook = [];
	/** Is exiting already */
	#exiting = false;
	/** Always online state */
	AlwaysOn = true;

	/** Amount of entries in the address book */
	get length() {return this.#AddressBook.length;}
	/** @returns {SDCPPrinter[]} - An array of printers */
	get Printers() {return this.#AddressBook;}

	/**
	 * Create a new SDCPAddressBook, have it loadable
	 * @param {boolean} Load - Load the address book from the file
	 * @param {function(Error?): void} Callback - Callback function to be called when the load process is complete
	 * @returns {Promise<SDCPAddressBook>} - Promise that resolves with the SDCPAddressBook object
	 */
	constructor(Load=false, Callback)
	{
		//this.SetupAutoSave();

		if (!Load) return this;
		this.LoadSync();
	}

	/**
	 * Save the address book to a file
	 * @param {function(Error?): void} Callback - Callback function to be called when the save process is complete
	 * @returns {Promise<void>} - Promise that resolves when the save process is complete
	 */
	Save(Callback)
	{
		if (Callback === undefined)
			return new Promise((resolve,reject) => {this.Save((err) => {if (err) return reject(err); resolve();});});

		console.log(`Saving address book (${this.#AddressBook.length} entries) to ${this.#addressBookFile}`);

		var Entries = this.#AddressBook.map(e=>e.toJSON());
		fs.writeFile(this.#addressBookFile, JSON.stringify(Entries, undefined, "\t"), (err) =>
		{
			if (err) return typeof Callback === "function" ? Callback(err) : undefined;
			if (typeof Callback === "function")
				Callback
		});
	}

	/**
	 * Asynchoronously save the address book to a file
	 * @returns {Boolean} - True if the save was successful
	 */
	SaveSync()
	{
		console.log(`Saving address book (${this.#AddressBook.length} entries) to ${this.#addressBookFile}`);

		var Entries = this.#AddressBook.map(e=>e.toJSON());
		fs.writeFileSync(this.#addressBookFile, JSON.stringify(Entries, undefined, "\t"));
		return true;
	}

	/**
	 * Asynchoronously load the address book from a file
	 * @returns {Boolean} - True if the load was successful
	 */
	LoadSync()
	{
		try
		{
			var data = fs.readFileSync(this.#addressBookFile);
			var Entries = JSON.parse(data);
			Entries.forEach(e=>
			{
				/** SDCPPrinter.constructor */
				var PrinterType = SDCPDiscovery.PrinterType(e);
				this.Add(new PrinterType({...e, AutoReconnect: this.AlwaysOn ? true : false}));
			});

			console.log(`Loaded address book (${this.#AddressBook.length} entries) from ${this.#addressBookFile}`);
			return true;
		} catch (err)
		{
			return false;
		}
	}

	/**
	 * Load the address book from a file
	 * @param {function(Error?): void} Callback - Callback function to be called when the load process is complete
	 * @returns {Promise<void>} - Promise that resolves when the load process is complete
	 */
	Load(Callback)
	{
		if (Callback === undefined)
			return new Promise((resolve,reject) => {this.Load((err) => {if (err) return reject(err); resolve();});});

		fs.readFile(this.#addressBookFile, (err, data) =>
		{
			if (err) return typeof Callback === "function" ? Callback(err) : undefined;
			var Entries = JSON.parse(data);
			this.#AddressBook = Entries.map(e=>
			{
				var PrinterType = SDCPDiscovery.PrinterType(e);
				return new PrinterType({...e, AutoReconnect: this.AlwaysOn ? true : false})
			});
			console.log(`Loaded address book (${this.#AddressBook.length} entries) from ${this.#addressBookFile}`);
			if (typeof Callback === "function")
				Callback();
		});
	}

	/**
	 * Clear the address book
	 */
	Clear()
	{
		this.#AddressBook = [];
	}

	/**
	 * Add a printer to the address book
	 * @param {SDCPPrinter} Printer - The printer to add to the address book
	 * @returns {boolean} - True if the printer was added, false if it was already in the address book
	 */
	Add(Printer)
	{
		if (Printer === undefined || Printer === null)
			return false;
		if (!Array.isArray(Printer))
			Printer = [Printer];

		Printer.forEach(p_orig=>
		{
			if (p_orig.MainboardID === undefined || !p_orig.toJSON) return;
			var p = p_orig.toJSON();
			var existingEntry = this.#AddressBook.find(e=>e.MainboardID === p.MainboardID);
			if (!existingEntry)
			{
				console.log(`Adding printer ${p.MainboardID} to address book`);
				this.#AddressBook.push(p_orig);
				return;
			}

			console.log(`Updating printer ${p.MainboardID} in address book`);
			for (var key in p)
				existingEntry[key] = p[key];
		});
		return true;
		//Already existing?
	}

	/**
	 * Remove a printer from the address book
	 * @param {SDCPPrinter|string} Printer - Can be a printer entry or a string of the printer's ID
	 * @returns {boolean} - True if the printer was removed, false if it was not found
	 */
	Remove(Printer)
	{
		if (typeof Printer === 'string')
			Printer = this.#AddressBook.find(e=>e.Id === Printer);
		if (!Printer) return false;

		this.#AddressBook = this.#AddressBook.splice(this.#AddressBook.indexOf(Printer), 1);
		return true;
	}

	/**
	 * Setup auto save
	 */
	SetupAutoSave()
	{
		// Handle normal exit
		process.on('exit', () =>
		{
			if (this.#exiting) return;
			this.#exiting = true;
			this.SaveSync();
		});
		// Handle Ctrl+C
		process.on('SIGINT', () =>
		{
			if (this.#exiting) return;
			this.#exiting = true;
			console.log('\nCtrl+C detected. Saving data...');
			this.SaveSync();
			process.exit(0);
		});
		// Handle uncaught exceptions
		process.on('uncaughtException', (error) =>
		{
			console.log(error);

			if (this.#exiting) return;
			this.#exiting = true;
			console.error('Uncaught Exception:', error);
			this.SaveSync();
			process.exit(1);
		});
	}
}

var GlobalAddressbook = new SDCPAddressBook(true);
module.exports = GlobalAddressbook;