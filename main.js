//process.env.UV_THREADPOOL_SIZE = 128;

const discord= require("discord.js");
const fs=require("fs");
const cmd= require("./command.js");
const brender=require("./brender.js");

const {auth_token}=JSON.parse(fs.readFileSync("auth.json").toString().replace(/[^ -~]+/g,""));

const client=new discord.Client();

const commandHandler=new cmd.CommandHandler();

const qingMachine=new brender.QueueingMachine();



commandHandler.addCommand(new cmd.Command("br",["startFrame","endFrame"],(message,paramList)=>{
    //message.channel.send(`${message.author} ${paramList.str}`);

    if(message.attachments.size>0)
    {
        if (isNaN(paramList.startFrame) || isNaN(paramList.endFrame))
            message.reply("Start frame and End frame must be numbers");
        else 
        {
            if(paramList.startFrame != paramList.endFrame)
                message.reply("Sorry I don't support multiframe renders yet");
            else
                qingMachine.addTask(message,paramList.startFrame,paramList.endFrame);
        }
    }
    else
    message.reply("Please send the .blend file as an attachment");
}));

commandHandler.addCommand(new cmd.Command("status",["jobID"],(message,paramList)=>{
    qingMachine.reportStatus(message,paramList.jobID);
}));
commandHandler.addCommand(new cmd.Command("assist",["str"],(message,paramList)=>{
    if(message.author.id==='488717813234794506')
        console.log(message.channel.send(`${paramList.str}`));
}));
client.on('ready',()=>{
});
client.on('message',(message)=>
{
    commandHandler.processCommand(message);
});
client.login(auth_token).catch((err)=>{
    console.log(err);
});

//test("target.blend");
/*
function test(fileName)
{
    const blender = spawn("blender",[fileName,'--background','--render-frame','1']);
            let lineCount = 0;
            const readInterface = readline.createInterface({
                input: blender.stdout,
                output: process.stdout,
                console: false
            });
            blender.on('error',(err)=>{
                console.log(err);
            });
            let ret = new Promise((resolve, reject) => {
                readInterface.on("line", (line) => {
                    if (lineCount == 3) {
                        blender.kill("SIGINT");
                        readInterface.close();
                        resolve(line.startsWith("Error: File format is not supported in file"));
                    }
                    else
                        lineCount++;
                });
            });
            return ret;
        
}*/