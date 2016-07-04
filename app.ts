/// <reference path="node-4.d.ts" />

import * as http from "http";
import * as url from "url";
import * as fs from "fs";
import * as child_process from "child_process";

const PORT: number = 8080;

var files_to_serve =
    {
        reference: "",
        reads: <Array<string>>([ ])
    };

process.argv.forEach(function (val: string, index: number, array: Array<string>)
{
    if (index == 2)
    {
        files_to_serve.reference = val;
    }
    else if (index > 2)
    {
        files_to_serve.reads.push(val);
    }
});

function random_string(length: number) : string
{
    var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var result = "";
    for (var i = length; i > 0; --i)
        result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}

function handle_get(request: http.ServerRequest, response: http.ServerResponse): void
{
    var request_path = url.parse(request.url).pathname;
    var regex_res = request_path.match(/^\/([0-9]+|ref|ref\.amb|ref\.ann|ref\.bwt|ref\.pac|ref\.sa)$/);
    if (!regex_res || regex_res.length < 2)
    {
        response.writeHead(404);
        response.end();
    }
    else
    {
        var file_path = "";
        if (regex_res[1] == "ref")
        {
            file_path = files_to_serve.reference;
        }
        else if (regex_res[1] == "ref.amb")
        {
            file_path = files_to_serve.reference + ".amb";
        }
        else if (regex_res[1] == "ref.ann")
        {
            file_path = files_to_serve.reference + ".ann";
        }
        else if (regex_res[1] == "ref.bwt")
        {
            file_path = files_to_serve.reference + ".bwt";
        }
        else if (regex_res[1] == "ref.pac")
        {
            file_path = files_to_serve.reference + ".pac";
        }
        else if (regex_res[1] == "ref.sa")
        {
            file_path = files_to_serve.reference + ".sa";
        }
        else
        {
            var read_index = parseInt(regex_res[1]);
            if (read_index < files_to_serve.reads.length)
                file_path = files_to_serve.reads[read_index];
        }

        fs.exists(file_path, function(exists)
        {
            if(!exists)
            {
                response.writeHead(404);
                response.end();
            }
            else
            {
                //response.writeHead(200, mimeType);

                var file_stream = fs.createReadStream(file_path);
                file_stream.pipe(response);
            }
        });
    }
}

function handle_put(request: http.ServerRequest, response: http.ServerResponse): void
{
    var request_path = url.parse(request.url).pathname;
    var regex_res = request_path.match(/^\/([0-9]+)$/);
    if (!regex_res || regex_res.length < 2)
    {
        response.writeHead(404);
        response.end();
    }
    else
    {
        var read_index = parseInt(regex_res[1]);
        if (read_index >= files_to_serve.reads.length)
        {
            response.writeHead(404);
            response.end();
        }
        else
        {
            var bam_file_path = files_to_serve.reads[read_index] + ".bam";
            var tmp_bam_file_path = bam_file_path + random_string(16);

            var file_stream = fs.createWriteStream(tmp_bam_file_path);
            request.pipe(file_stream);
            request.on("error", function()
            {
                response.writeHead(500);
                response.end();
            });
            request.on("end", function()
            {
                fs.rename(tmp_bam_file_path, bam_file_path, function(err)
                {
                    if (err)
                    {
                        response.writeHead(500);
                        response.end();
                    }
                    else
                    {
                        response.writeHead(201);
                        response.end();
                    }
                });
            });
        }
    }
}


function handle_request(request: http.ServerRequest, response: http.ServerResponse): void
{
    // TODO: basic auth

    if (request.method == "GET")
        handle_get(request, response);
    else if (request.method == "PUT")
        handle_put(request, response);
    else
    {
        response.writeHead(405); // Method Not Allowed
        response.end();
    }
}

class Machine
{
    name: string;
    host: string;
    cert_path: string;

    constructor(name, host, cert_path)
    {
        this.name = name;
        this.host = host;
        this.cert_path = cert_path;
    }
}

function create_machine(cb: (exit_status: number, mach: Machine)=>void): void
{
    var machine_name: string = "cloud-aln-" + random_string(16);
    var create_machine_proc: child_process.ChildProcess = child_process.spawn("docker-machine", ["create", "--driver", "virtualbox", machine_name]);

    create_machine_proc.stdout.on("data", function(data: Buffer)
    {
        process.stdout.write(data.toString("utf8"));
    });

    create_machine_proc.stderr.on("data", function(data: Buffer)
    {
        process.stderr.write(data);
    });

    create_machine_proc.on("close", function(exit_code: number)
    {
        if (exit_code)
        {
            cb(exit_code, null);
        }
        else
        {
            var env_data: string = "";
            var get_machine_env_proc = child_process.spawn("docker-machine", ["env", machine_name]);
            get_machine_env_proc.stdout.on("data", function(data: Buffer)
            {
                env_data += data.toString("utf8");
            });

            get_machine_env_proc.on("close", function(exit_code: number)
            {
                if (exit_code)
                {
                    // TODO: Destroy machine.
                    cb(exit_code, null);
                }
                else
                {
                    var host_res = new RegExp("export DOCKER_HOST=\"tcp\:([^\"]+)\"").exec(env_data);
                    var cert_path_res = new RegExp("export DOCKER_CERT_PATH=\"([^\"]+)\"").exec(env_data);

                    if (!host_res || host_res.length != 2 || !cert_path_res || cert_path_res.length != 2)
                    {
                        console.error("Could not parse docker machine environment");
                        // TODO: Destroy machine.
                        cb(-1, null);

                    }
                    else
                    {
                        cb(0, new Machine(machine_name, host_res[1], cert_path_res[1]));
                    }
                }
            });
        }
    });
}


var server = http.createServer(handle_request);
server.listen(PORT, function(): void
{
    console.log("Server listening on: http://localhost:%s", PORT);
});

create_machine(function(exit_code: number, machine: Machine): void
{
    if (exit_code)
    {
        process.exit(exit_code);
    }
    else
    {
        console.log(machine);
    }
});




