const http = require('http');
const fs = require('fs');
const path = require('path');
const debug = false;

class HTTPServer
{
	#server;
	#DeliverFile;
	#DeliverName;

	/**
	 * Start an HTTP server that listens on the specified port and delivers the specified file (regardless of path).
	 * @param {number} Port The port to listen on.
	 * @param {string} DeliverFile The file to deliver.
	 * @param {string} DeliverName The name to deliver the file
	 * @param {function} SuccessCallback The callback to call when the server has sent the file.
	 * @returns {void}
	 */
	async Listen (Port = undefined, DeliverFile, DeliverName, SuccessCallback)
	{
		if (this.#server)
			this.Close();

		this.#DeliverFile = DeliverFile;
		this.#DeliverName = DeliverName;
		this.#server = http.createServer((req, res) => 
		{
			if (debug) console.log(`Request ${req.method} for ${req.url} from ${req.socket.remoteAddress}`);
			const fileStream = fs.createReadStream(this.#DeliverFile);
			
			//Do they want the head?
			if (req.method === 'HEAD')
			{
				fs.stat(this.#DeliverFile, (err, stats) =>
				{
					if (err)
					{
						res.writeHead(500, {'Content-Type': 'text/plain'});
						res.end('Internal Server Error');
						return;
					}
					res.writeHead(200, 
					{
						'Content-Type': 'application/octet-stream',
						'Content-Length': stats.size,
						'Content-Disposition': `attachment; filename="${this.#DeliverName}"`,
					});
					res.end();
				});
				return;
			}

			//Else we're sending

			//Callback on success
			fileStream.on('close', () =>
			{
				if (debug) console.log(`   File delivered`);
				if (SuccessCallback)
					SuccessCallback();
				SuccessCallback = undefined;
			});
						
			//Open up the file and pipe it to the response
			fileStream.on('open', () => 
			{
				fs.stat(this.#DeliverFile, (err, stats) =>
				{
					if (debug) console.log(`    Delivering ${this.#DeliverFile} (${stats.size} bytes) as ${this.#DeliverName}`);
					if (err)
					{
						res.writeHead(500, {'Content-Type': 'text/plain'});
						res.end('Internal Server Error');
						return;
					}

					res.writeHead(200, 
					{
						'Content-Type': 'application/octet-stream',
						'Content-Length': stats.size,
						'Content-Disposition': `attachment; filename="${this.#DeliverName}"`,
					});
					fileStream.pipe(res);			
				});
			});
			
			fileStream.on('error', (err) => 
			{
				//console.error('Error reading file:', err);
				res.writeHead(500, {'Content-Type': 'text/plain'});
				res.end('Internal Server Error');
			});
		});

		this.#server.listen(Port);		
	}

	get Port() {return this.#server.address().port;}


	Close()
	{
		if (this.#server)
		{
			this.#server.close();
			this.#server = null;
		}
	}	
}

module.exports = HTTPServer;