const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');
const https = require('https');
const rimraf= require("rimraf");
const {MessageAttachment}=require('discord.js');

const jobFolder = __dirname + '/job/';

const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const tempName = "target.blend";

const tempFile = __dirname + "/" + tempName;
const threads = 1;

function randString() {
    let ret = "";
    for (let i = 0; i < 8; i++)
        ret += charset[Math.floor(Math.random() * charset.length)];
    return ret;
}
function generateFileName(filename, issuedTimestamp, blob) {
    return crypto.createHash('md5').update(filename + issuedTimestamp + randString()+ blob).digest("hex");
}
class RenderTask {
    constructor(filename, userID, startFrame, endFrame) {
        this.filename = filename;
        this.issuedTimestamp = Date.now();
        this.userID = userID;

        this.progress=0;

        this.logLine="";

        if(endFrame<startFrame)
        {
            let t=startFrame;
            startFrame=endFrame;
            endFrame=t;
        }

        this.startFrame=startFrame;
        this.endFrame=endFrame;

        this.singleFrame=false;

        if(this.startFrame===this.endFrame)
            this.singleFrame=true;
        
        this.totalFrames=this.endFrame-this.startFrame+1;

        this.jobId = generateFileName(this, filename, this.issuedTimestamp, "");
        if (fs.existsSync(this.jobId))
            this.jobId = generateFileName(this.jobId + '1', this.issuedTimestamp, "");
        this.jobPath = jobFolder + this.jobId + '/';
        this.jobPathOutput = this.jobPath + "output/";
    }
    start() {
        console.log("Starting task:", this.jobId);
        try {

            const blender = spawn('blender', ['-b', tempName, '-o', this.jobPathOutput+'frame_#', '-s', this.startFrame, '-e', this.endFrame, '-t', threads, '-a']);
            const readInterface = readline.createInterface({
                input: blender.stdout,
                output: process.stdout,
                console: false
            });
            blender.on('close', (code) => {
                readInterface.close();
                if (code === 0)
                    this.success();
                else
                    this.fail(this.logLine);
            });
            readInterface.on('line', (line) => {

                if(line.startsWith("Error:"))
                    this.logLine=line;
                if (line.lastIndexOf(" Sample ")!=-1) {

                    let frameNo=Number(line.substring(4, line.indexOf(' ',4 + 1)));
                    let renderedIx=line.indexOf("Rendered ");
                    let slashIx=line.indexOf('/',renderedIx+1);
                    let nextSpaceIx=line.indexOf(' ',slashIx+1);

                    let tileCount=Number(line.substring(renderedIx+9,slashIx));
                    let tileCount_t=Number(line.substring(slashIx+1,nextSpaceIx));

                    let frameProg=frameNo-this.startFrame;
                    this.progress=((frameProg>=0?frameProg:0)*tileCount_t+tileCount)/(this.totalFrames*tileCount_t);
                }
            });
        }
    catch(e){console.log(e)};
}
}
class RenderQueue {
    constructor(maxLen) {
        this.maxLen = maxLen;
        this.q = [];
    }
    insertTask(task) {
        if (this.q.length < this.maxLen)
            this.q.push(task);
    }
    findTask(id)
    {
        return this.q.find((elm)=>elm.jobId==id);
    }
    advanceQueue() {
        this.q.shift();
    }
    empty()
    {
        return this.q.length==0;
    }
    currentTask() {
        return this.q[0];
    }

}
class QueueingMachine {
    constructor() {
        this.q = new RenderQueue(10);
    }
    isBlendFile(fileName) {
        try {
            const blender = spawn("blender", [fileName, '--background', '--render-frame', '1']);
            let lineCount = 0;
            const readInterface = readline.createInterface({
                input: blender.stdout,
                output: process.stdout,
                console: false
            });
            blender.on('error', (err) => {
                console.log(err);
            });
            let ret = new Promise((resolve, reject) => {
                readInterface.on("line", (line) => {
                    if (lineCount == 2) {
                        blender.kill("SIGKILL");
                        readInterface.close();

                        resolve(!line.startsWith("Error: File format is not supported in file"));
                    }
                    else
                        lineCount++;
                });
            });
            return ret;
        }
        catch (error) { console.log(error); }
    }
    finishTask() {
        let lastTask = this.q.currentTask();
        this.q.advanceQueue();
        if(!this.q.empty())
            this.q.currentTask().start();
        rimraf(lastTask.jobPath,()=>{
            console.log("Deleted ",lastTask.jobId);
        });
    }
    reportStatus(message,id)
    {
        let found=this.q.findTask(id);
        if(found==undefined || found.userID!=message.author.id)
            message.reply("You don't have any render jobs with that id");
        else
            message.reply(`${Math.round(found.progress*100)}% done.`);
    }
    addTask(message, startFrame, endFrame) {
        let writeStream = fs.createWriteStream(tempFile);
        let attach = message.attachments.first();
        https.get(attach.url, (response) => {
            response.pipe(writeStream);
        });
        writeStream.on('finish', () => {
            console.log("Downloaded file");
            if (this.isBlendFile(tempFile).then((res) => {
                if (res) {
                    let renderTask = new RenderTask(attach.name, message.author.id, startFrame, endFrame);

                    message.reply(`Started rendering. Here's the job ID: ${renderTask.jobId}. Use it to find the status of the render job like this: !status <job ID> `);
                    //console.log(startFrame, endFrame);

                    fs.mkdirSync(renderTask.jobPath);
                    fs.mkdirSync(renderTask.jobPath + "output");
                    fs.copyFileSync(tempFile, renderTask.jobPath + tempName);
                    this.q.insertTask(renderTask);


                    if (this.q.currentTask() == renderTask)
                        renderTask.start();

                    renderTask.fail = (err) => {
                        message.reply(`${renderTask.filename} having id: ${renderTask.jobId} failed to render. Error Log:\n ${err}`);

                        this.finishTask();
                    };
                    renderTask.success = () => {
                        message.reply(`Completed rendering ${renderTask.filename} having id: ${renderTask.jobId} . Uploading files...`);
                        //Upload data
                        if(renderTask.singleFrame)
                        {
                            let file=fs.readdirSync(renderTask.jobPathOutput)[0];
                            console.log(file);
                            message.channel.send(new MessageAttachment(renderTask.jobPathOutput+file));
                        }
                        else;
                            //Zip and upload to cloud
                        this.finishTask();

                    };
                }
                else
                    message.reply("Invalid .blend file");
            }));

        }
        );

        writeStream.on('error', () => {
            message.reply("Internal server error. Please try again");
        });
    }
}

module.exports = { QueueingMachine };