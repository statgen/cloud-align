/// <reference path="node-4.d.ts" />

import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as fs from "fs";
import * as child_process from "child_process";

const PORT: number = 8080;
const HOST: string = "localhost";
const SOCKET_ADDRESS = HOST + ":" + PORT.toString();

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
    private _name: string;
    private _host: string;
    private _cert_path: string;
    private _cores: number;

    get_name(): string { return this._name; }
    get_host(): string { return this._host; }
    get_cert_path(): string { return this._cert_path; }
    get_num_cores(): number { return this._cores; }

    constructor(name, host, cert_path)
    {
        this._name = name;
        this._host = host;
        this._cert_path = cert_path;
        this._cores = 48;
    }

    run_container(image: string, cmd: Array<string>, cb: (exit_status: number)=>void): void
    {
        var sock_addr_arr = this._host.split(":");
        var options =
        {
            hostname: sock_addr_arr[0],
            port: parseInt(sock_addr_arr[1]),
            path: '/containers/create',
            method: 'POST',
            headers:
            {
                "Content-Type": "application/json"
            },
            key: fs.readFileSync(this._cert_path + "/key.pem"), // TODO: make these async
            cert: fs.readFileSync(this._cert_path + "/cert.pem"),
            agent: false
        };

        var req_entity =
        {
            Image: image,
            Cmd: cmd
        };

        var req: http.ClientRequest = https.request(options, function (res: http.ClientResponse)
        {
            // TODO: Finish.
        });

        req.end(JSON.stringify(req_entity));

    }

    private static delete_machine_by_name(name: string, cb: (exit_status: number)=>void): void
    {
        var rm_proc: child_process.ChildProcess = child_process.spawn("docker-machine", ["rm", "-y", name]);

        rm_proc.stdout.on("data", function(data: Buffer)
        {
            process.stdout.write(data);
        });

        rm_proc.stderr.on("data", function(data: Buffer)
        {
            process.stderr.write(data);
        });

        rm_proc.on("close", cb);
    }

    static delete_machine(mach: Machine, cb: (exit_status: number)=>void): void
    {
        Machine.delete_machine_by_name(mach.get_name(), cb);
    }

    static create_machine(cb: (exit_status: number, mach: Machine)=>void): void
    {
        var machine_name: string = "cloud-aln-" + random_string(16);
        var create_machine_proc: child_process.ChildProcess = child_process.spawn("docker-machine", ["create", "--driver", "virtualbox", machine_name]); // TODO: specify cores/mem

        create_machine_proc.stdout.on("data", function(data: Buffer)
        {
            process.stdout.write(data);
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
                        Machine.delete_machine_by_name(machine_name, function(exit_status: number) {});
                        cb(exit_code, null);
                    }
                    else
                    {
                        var host_res = new RegExp("export DOCKER_HOST=\"tcp\:\/\/([^\"]+)\"").exec(env_data);
                        var cert_path_res = new RegExp("export DOCKER_CERT_PATH=\"([^\"]+)\"").exec(env_data);

                        if (!host_res || host_res.length != 2 || !cert_path_res || cert_path_res.length != 2)
                        {
                            console.error("Could not parse docker machine environment");
                            Machine.delete_machine_by_name(machine_name, function(exit_status: number) {});
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
}


var server = http.createServer(handle_request);
server.listen(PORT, function(): void
{
    console.log("Server listening on: http://localhost:%s", PORT);
});

Machine.create_machine(function(exit_code: number, machine: Machine): void
{
    if (exit_code)
    {
        process.exit(exit_code);
    }
    else
    {
        var commands: Array<string> =
            [
                "curl http://" + SOCKET_ADDRESS + "/ref.amb > ./ref.amb",
                "curl http://" + SOCKET_ADDRESS + "/ref.ann > ./ref.ann",
                "curl http://" + SOCKET_ADDRESS + "/ref.bwt > ./ref.bwt",
                "curl http://" + SOCKET_ADDRESS + "/ref.pac > ./ref.pac",
                "curl http://" + SOCKET_ADDRESS + "/ref.sa > ./ref.sa"
            ];

        for (var i = 0; i < files_to_serve.reads.length; ++i)
        {
            commands.push("bwa mem -t " + machine.get_num_cores().toString() + " ./ref http://" + SOCKET_ADDRESS +  "/" + i.toString() + " | curl -X PUT --data-binary @- http://" + SOCKET_ADDRESS + "/" + i.toString());
        }

        machine.run_container("statgen/alignment", ["/bin/bash", "-c", commands.join("; ")], function(exit_status: number)
        {


            Machine.delete_machine(machine, function(exit_status: number)
            {
                console.log(exit_status);
            });
        });
    }
});




