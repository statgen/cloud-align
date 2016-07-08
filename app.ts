/// <reference path="node-4.d.ts" />

import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as fs from "fs";
import * as util from "./util";
import {Machine} from "./machine"

var PORT: number = 8080;
var HOST: string = "";

var files_to_serve =
{
    reference: "",
    reads: <Array<string>>([ ])
};

process.argv.forEach(function (val: string, index: number, array: Array<string>)
{
    if (index === 2)
    {
        var sock_addr_arr = val.split(":");
        HOST = sock_addr_arr[0];
        if (sock_addr_arr.length > 1)
            PORT = parseInt(sock_addr_arr[1]);
    }
    else if (index === 3)
    {
        files_to_serve.reference = val;
    }
    else if (index > 3)
    {
        files_to_serve.reads.push(val);
    }
});

const SOCKET_ADDRESS = HOST + ":" + PORT.toString();

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
            var bam_file_path = files_to_serve.reads[read_index].replace(/\.fastq\.gz$/, ".sam.gz");
            var tmp_bam_file_path = bam_file_path + util.random_string(16);

            var file_stream = fs.createWriteStream(tmp_bam_file_path);
            request.pipe(file_stream);
            request.on("error", function(e: Error)
            {
                console.log("PUT Error:");
                console.log(e);
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
            commands.push("bwa mem -t " + machine.get_num_cores().toString() + " ./ref http://" + SOCKET_ADDRESS +  "/" + i.toString() + " | gzip -3 > ./aln.sam.gz && curl -T ./aln.sam.gz http://" + SOCKET_ADDRESS + "/" + i.toString() + "; rm -f ./aln.sam.gz");
        }

        machine.run_container("statgen/alignment", ["/bin/bash", "-c", commands.join("; ")], function(run_exit_status: number)
        {
            console.log("Run container exit status: " + run_exit_status);

            Machine.destroy_machine(machine, function (destroy_exit_status:number)
            {
                console.log("Destroy machine exit status: " + destroy_exit_status);
                process.exit(run_exit_status || destroy_exit_status);
            });
        });
    }
});




