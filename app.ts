/// <reference path="node-4.d.ts" />
/// <reference path="node-getopt.d.ts" />

// Node
import * as http from "http";
import * as https from "https";
import * as url from "url";
import * as fs from "fs";

// 3rd Party
import Getopt = require("node-getopt");

// Local
import * as util from "./util";
import {Machine} from "./machine"
import ParsedOption = require("node-getopt");

var driver = ""

var files_to_serve =
{
    reference: "",
    reads: <Array<string>>([ ])
};


var opt =  Getopt.create(
    [
        ["g", "gce-proj=GOOGLE_PROJECT_ID"  , "Google cloud project."],
        ["h", "sock-addr=SOCKET_ADDRESS"    , "Socket address (host:port) for file server."],
        ["n", "nodes=NUM_NODES"             , "Max number of compute nodes to created."]
    ])
    .parse(process.argv); // parse command line);

const SOCKET_ADDRESS = opt.options["sock-addr"] || "localhost:8080";
var sock_addr_arr = SOCKET_ADDRESS.split(":");
const HOST: string = sock_addr_arr[0];
const PORT = (sock_addr_arr.length > 1 ? parseInt(sock_addr_arr[1]) : 8080);
const GCE_PROJECT_ID: string =  opt.options["gce-proj"] || "";

if (opt.argv.length < 4)
{
    console.error("Usage: node app.js [options ...] <ref_path> <fastq_paths ...>");
    process.exit(-1);
}

opt.argv.forEach(function (val: string, index: number, array: Array<string>)
{
    if (index === 2)
    {
        files_to_serve.reference = val;
    }
    else if (index > 2)
    {
        files_to_serve.reads.push(val);
    }
});

var NUM_COMPUTE_NODES: number = parseInt(opt.options["nodes"] || "1");
if (NUM_COMPUTE_NODES < 1)
    NUM_COMPUTE_NODES = 1;
if (NUM_COMPUTE_NODES > files_to_serve.reads.length)
    NUM_COMPUTE_NODES = files_to_serve.reads.length;


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


var finish_counter: number = 0;
for (var node_i: number = 0; node_i < NUM_COMPUTE_NODES; ++node_i)
{

    (function (node_index: number)
    {
        Machine.create_machine(GCE_PROJECT_ID, function (exit_code:number, machine:Machine):void
        {
            if (exit_code)
            {
                process.exit(exit_code);
            }
            else
            {
                var commands:Array<string> =
                    [
                        "curl http://" + SOCKET_ADDRESS + "/ref.amb > ./ref.amb",
                        "curl http://" + SOCKET_ADDRESS + "/ref.ann > ./ref.ann",
                        "curl http://" + SOCKET_ADDRESS + "/ref.bwt > ./ref.bwt",
                        "curl http://" + SOCKET_ADDRESS + "/ref.pac > ./ref.pac",
                        "curl http://" + SOCKET_ADDRESS + "/ref.sa > ./ref.sa"
                    ];

                for (var i = 0; i < files_to_serve.reads.length; ++i)
                {
                    if (i % NUM_COMPUTE_NODES === node_index)
                        commands.push("bwa mem -t " + machine.get_num_cores().toString() + " ./ref http://" + SOCKET_ADDRESS + "/" + i.toString() + " | gzip -3 > ./aln.sam.gz && curl -T ./aln.sam.gz http://" + SOCKET_ADDRESS + "/" + i.toString());
                }

                machine.run_container("statgen/alignment", ["/bin/bash", "-c", commands.join(" && ")], function (run_exit_status:number)
                {
                    console.log("Run container exit status: " + run_exit_status);

                    Machine.destroy_machine(machine, function (destroy_exit_status:number)
                    {
                        console.log("Destroy machine exit status: " + destroy_exit_status);
                        ++finish_counter;
                        if (finish_counter === NUM_COMPUTE_NODES)
                            process.exit(run_exit_status || destroy_exit_status);
                    });
                });
            }
        });
    })(node_i);
}




