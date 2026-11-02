const http=require('node:http'), fs=require('node:fs'), path=require('node:path');
http.createServer(async(req,res)=>{
 const name=req.url.slice(1);
 if(req.method!=='POST'||!['hospital-phone.png','remote-phone.png','hospital-dark-phone.png','remote-dark-phone.png','pending-dark-phone.png','call-dark-phone.png','doctor-incoming-phone.png','doctor-call-phone.png','doctor-call-fullscreen-phone.png'].includes(name)){res.writeHead(404);return res.end();}
 const chunks=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>8*1024*1024){res.writeHead(413);return res.end();}chunks.push(chunk);}
 const data=Buffer.concat(chunks);if(data.subarray(1,4).toString()!=='PNG'){res.writeHead(400);return res.end();}
 const output=path.join(__dirname,'../.impeccable/review/consultation-modes');fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,name),data);
 console.log('Saved device capture '+name);res.end('ok');
}).listen(4041,'127.0.0.1',()=>console.log('Device capture collector ready'));
