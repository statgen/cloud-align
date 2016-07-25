/// <reference path="node-4.d.ts" />
import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as child_process from "child_process";
import * as util from "./util";

export class Machine
{
    private _name: string;
    private _host: string;
    private _cert_path: string;
    private _cores: number;

    get_name(): string { return this._name; }
    get_host(): string { return this._host; }
    get_cert_path(): string { return this._cert_path; }
    get_num_cores(): number { return this._cores; }

    constructor(name: string, host: string, cert_path: string, cores: number)
    {
        this._name = name;
        this._host = host;
        this._cert_path = cert_path;
        this._cores = cores;
    }

    run_container(image: string, cmd: Array<string>, cb: (exit_status: number)=>void): void
    {
        var sock_addr_arr = this._host.split(":");
        var options: https.RequestOptions =
        {
            hostname: sock_addr_arr[0],
            port: parseInt(sock_addr_arr[1]),
            path: "/images/create?fromImage=" + image,
            method: "POST",
            headers:
            {
                "Content-Type": "application/json"
            },
            key: fs.readFileSync(this._cert_path + "/key.pem"), // TODO: make these async
            cert: fs.readFileSync(this._cert_path + "/cert.pem"),
            ca: fs.readFileSync(this._cert_path + "/ca.pem"),
            agent: false
        };

        console.log("Pulling image...");
        var req: http.ClientRequest = https.request(options, function (res: http.ClientResponse)
        {
            res.on("data", function(data: Buffer) {});

            res.on("error", function(e: Error)
            {
                console.error(e);
                cb(-1);
            });

            res.on("end", function()
            {
                if (res.statusCode < 200 || res.statusCode >= 300)
                {
                    console.error("Received invalid status code (" + res.statusCode + ") during image pull.");
                    cb(-1);
                }
                else
                {
                    var req_entity =
                    {
                        Image: image,
                        Cmd: cmd
                    };

                    console.log("Creating container...");
                    options.path = "/containers/create";
                    var req: http.ClientRequest = https.request(options, function (res: http.ClientResponse)
                    {
                        var res_entity: Array<Buffer> = [];
                        res.on("data", function(data: Buffer)
                        {
                            res_entity.push(data);
                        });

                        res.on("error", function(e: Error)
                        {
                            console.error(e);
                            cb(-1);
                        });

                        res.on("end", function()
                        {
                            if (res.statusCode < 200 || res.statusCode >= 300)
                            {
                                console.error("Received invalid status code (" + res.statusCode + ") during container creation.");
                                console.error(Buffer.concat(res_entity).toString());
                                cb(-1);
                            }
                            else
                            {
                                var resp_obj: any = {};
                                try
                                {
                                    resp_obj = JSON.parse(Buffer.concat(res_entity).toString());
                                }
                                catch (ex)
                                {
                                    console.error(ex);
                                    resp_obj = {};
                                }
                                
                                var container_id: string = resp_obj.Id;

                                console.log("Starting container...");
                                options.path = "/containers/" + container_id + "/start";
                                var req: http.ClientRequest = https.request(options, function (res: http.ClientResponse)
                                {
                                    res.on("error", function(e: Error)
                                    {
                                        console.error(e);
                                        cb(-1);
                                    });

                                    res.on("data", function(data: Buffer) {});

                                    res.on("end", function()
                                    {
                                        if (res.statusCode < 200 || res.statusCode >= 300)
                                        {
                                            console.error("Received invalid status code (" + res.statusCode + ") while starting container.");
                                            cb(-1);
                                        }
                                        else
                                        {
                                            console.log("Waiting container...");
                                            options.path = "/containers/" + container_id + "/wait";
                                            var req: http.ClientRequest = https.request(options, function (res: http.ClientResponse)
                                            {
                                                var res_entity: Array<Buffer> = [];
                                                res.on("data", function(data: Buffer)
                                                {
                                                    res_entity.push(data);
                                                });

                                                res.on("error", function(e: Error)
                                                {
                                                    console.error("Wait response error");
                                                    console.error(e);
                                                    cb(-1);
                                                });

                                                res.on("end", function()
                                                {
                                                    if (res.statusCode < 200 || res.statusCode >= 300)
                                                    {
                                                        console.error("Received invalid status code (" + res.statusCode + ") while waiting container.");
                                                        cb(-1);
                                                    }
                                                    else
                                                    {
                                                        var resp_obj: any = {};
                                                        try
                                                        {
                                                            resp_obj = JSON.parse(Buffer.concat(res_entity).toString());
                                                        }
                                                        catch (ex)
                                                        {
                                                            console.error(ex);
                                                            resp_obj = {};
                                                        }

                                                        if (typeof resp_obj.StatusCode !== "number")
                                                        {
                                                            console.error("Received invalid response from container wait.");
                                                            cb(-1);
                                                        }
                                                        else
                                                        {
                                                            cb(resp_obj.StatusCode);
                                                        }
                                                    }
                                                });
                                            });

                                            req.setSocketKeepAlive(true, 1000);

                                            req.on("error", function(e: Error)
                                            {
                                                console.error("Wait request error");
                                                console.log(e);
                                                cb(-1);
                                            });

                                            req.end();
                                        }
                                    });
                                });

                                req.end();
                            }
                        });
                    });

                    req.end(JSON.stringify(req_entity));
                }
            });
        });

        req.end();
    }

    static destroy_machine_by_name(name: string, cb: (exit_status: number)=>void): void
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

    static destroy_machine(mach: Machine, cb: (exit_status: number)=>void): void
    {
        Machine.destroy_machine_by_name(mach.get_name(), cb);
    }

    static create_machine(gce_project_id: string, cb: (exit_status: number, mach: Machine)=>void): void
    {
        var machine_name: string = "cloud-aln-" + util.random_string(16).toLowerCase();

        var create_args: Array<string> = [];
        if (gce_project_id)
            create_args = ["create", "--driver", "google", "--google-project", gce_project_id, "--google-zone", "us-central1-b", "--google-machine-type", "n1-highcpu-32", "--google-disk-size", "40", "--google-preemptible", machine_name];
        else
            create_args = ["create", "--driver", "virtualbox", machine_name];

        var create_machine_proc: child_process.ChildProcess = child_process.spawn("docker-machine", create_args);

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
                Machine.destroy_machine_by_name(machine_name, function(exit_status: number)
                {
                    cb(exit_code, null);
                });
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
                        Machine.destroy_machine_by_name(machine_name, function(exit_status: number)
                        {
                            cb(exit_code, null);
                        });
                    }
                    else
                    {
                        var host_res = new RegExp("export DOCKER_HOST=\"tcp://([^\"]+)\"").exec(env_data);
                        var cert_path_res = new RegExp("export DOCKER_CERT_PATH=\"([^\"]+)\"").exec(env_data);

                        if (!host_res || host_res.length != 2 || !cert_path_res || cert_path_res.length != 2)
                        {
                            console.error("Could not parse docker machine environment");
                            Machine.destroy_machine_by_name(machine_name, function(exit_status: number)
                            {
                                cb(-1, null);
                            });

                        }
                        else
                        {
                            cb(0, new Machine(machine_name, host_res[1], cert_path_res[1], gce_project_id.length ? 16 : 2));
                        }
                    }
                });
            }
        });
    }
}