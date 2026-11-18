import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mime from 'mime-types';
import { registerLocalAttachments } from '../../shared/local-attachments.js';
import { getGlobalImageAssetsDir } from '../../shared/image-attachments.js';
import multer from 'multer';
import { buildStoredAttachmentRecords, buildStoredImageRecords, ensureImageAssetsDir, isAllowedImageMimeType, openStoredAttachmentAsset, } from '../../modules/assets/services/image-assets.service.js';
const router = express.Router();
function localClient(req){const peer=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');return peer==='127.0.0.1'||peer==='::1'||Object.values(os.networkInterfaces()).flat().some(info=>info?.address===peer)}
router.get('/local-picker', (req,res)=>res.json({available:process.platform==='win32'&&localClient(req)}));
router.post('/local-picker', async(req,res)=>{
    let origin;try{origin=new URL(req.headers.origin)}catch{}
    if(!localClient(req)||!origin||origin.host!==req.headers.host)return res.sendStatus(403);
    try{
        const script="Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.OpenFileDialog;$d.Multiselect=$true;if($d.ShowDialog() -eq 'OK'){ConvertTo-Json -Compress -InputObject @($d.FileNames)}else{'[]'}";
        const {stdout}=await promisify(execFile)(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-STA','-EncodedCommand',Buffer.from("[Console]::OutputEncoding=[Text.Encoding]::UTF8;"+script,'utf16le').toString('base64')],{windowsHide:true,maxBuffer:1024*1024});
        const files=JSON.parse(stdout.trim().replace(/^\uFEFF/,''));
        if(!Array.isArray(files)||files.length>10)throw Error('每条消息最多添加 10 个附件');
        const attachments=await Promise.all(files.map(async file=>{const stat=await fs.stat(file);if(!stat.isFile())throw Error('请选择文件。');if(stat.size>512*1024*1024)throw Error('单个附件不能超过 512MB');return {path:file,name:path.basename(file),size:stat.size,mimeType:mime.lookup(file)||'application/octet-stream',localReference:true}}));
        registerLocalAttachments(files);res.json({attachments});
    }catch(error){res.status(400).json({error:error.message})}
});
// Multer writes uploads straight into the global assets folder; the service
// owns the folder location and the response record shape.
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        ensureImageAssetsDir()
            .then((assetsDir) => cb(null, assetsDir))
            .catch((error) => cb(error, ''));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const name=`${uniqueSuffix}-${sanitizedName}`;
        (req.uploadPaths??=[]).push(path.join(getGlobalImageAssetsDir(),name));
        cb(null, name);
    },
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (isAllowedImageMimeType(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 5,
    },
});
const attachmentUpload = multer({
    storage,
    limits: {
        fileSize: 512 * 1024 * 1024,
        files: 10,
    },
});
/**
 * Stores chat image attachments in the global `~/.cloudcli/assets` folder and
 * returns their absolute paths for use in provider prompts and chat history.
 */
router.post('/images', (req, res) => {
    upload.array('images', 5)(req, res, (err) => {
        if (err) {
            const message = err.code === 'ENOSPC' || err.code === 'EDQUOT' ? '磁盘空间不足，无法上传文件。请清理运行 BigaCli 的电脑磁盘后重试。' : err.code === 'LIMIT_FILE_SIZE' ? '单个附件不能超过 512MB' : err instanceof Error ? err.message : 'Upload failed';
            return res.status(400).json({ error: message });
        }
        const files = Array.isArray(req.files) ? req.files : [];
        if (files.length === 0) {
            return res.status(400).json({ error: 'No image files provided' });
        }
        res.json({ images: buildStoredImageRecords(files) });
    });
});
/**
 * Stores provider-neutral chat attachments. Files of any MIME type are
 * accepted because providers inspect them as data through their file-reading
 * tools; uploads are capped at 10 files and 512MB per file.
 */
router.post('/files', (req, res) => {
    attachmentUpload.array('files', 10)(req, res, async (err) => {
        if (err) {
            await Promise.all((req.uploadPaths||[]).map(file=>fs.rm(file,{force:true}).catch(()=>{})));
            const message = err.code === 'ENOSPC' || err.code === 'EDQUOT' ? '磁盘空间不足，无法上传文件。请清理运行 BigaCli 的电脑磁盘后重试。' : err.code === 'LIMIT_FILE_SIZE' ? '单个附件不能超过 512MB' : err instanceof Error ? err.message : 'Upload failed';
            return res.status(400).json({ error: message });
        }
        const files = Array.isArray(req.files) ? req.files : [];
        if (files.length === 0) {
            return res.status(400).json({ error: 'No files provided' });
        }
        res.json({ attachments: buildStoredAttachmentRecords(files) });
    });
});
/**
 * Serves one stored image asset by filename. Only files directly inside the
 * global assets folder are reachable; traversal attempts resolve to null.
 */
router.get('/images/:filename', async (req, res) => {
    const asset = await openStoredAttachmentAsset(req.params.filename);
    if (asset.status === 'invalid') {
        return res.status(400).json({ error: 'Invalid asset filename' });
    }
    if (asset.status === 'missing') {
        return res.status(404).json({ error: 'Asset not found' });
    }
    res.setHeader('Content-Type', asset.contentType);
    // Stored-XSS hardening: never let the browser sniff a different type, and
    // force SVGs (which can carry scripts when rendered as a document) to
    // download instead of rendering inline. The chat UI is unaffected — it
    // fetches assets as blobs and shows them through <img>, where SVG scripts
    // never execute.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (asset.contentType === 'image/svg+xml') {
        res.setHeader('Content-Disposition', 'attachment');
    }
    asset.stream.pipe(res);
    asset.stream.on('error', (error) => {
        console.error('Error streaming image asset:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error reading asset' });
        }
    });
});
/**
 * Downloads one stored non-image attachment. Content-Disposition prevents
 * uploaded HTML or other active formats from rendering in the application.
 */
router.get('/files/:filename', async (req, res) => {
    const asset = await openStoredAttachmentAsset(req.params.filename);
    if (asset.status === 'invalid') {
        return res.status(400).json({ error: 'Invalid asset filename' });
    }
    if (asset.status === 'missing') {
        return res.status(404).json({ error: 'Asset not found' });
    }
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename.replace(/["\r\n]/g, '_')}"`);
    asset.stream.pipe(res);
    asset.stream.on('error', (error) => {
        console.error('Error streaming attachment asset:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error reading asset' });
        }
    });
});
// Delete only upload copies, never an arbitrary host file.
router.delete('/files/:filename', async (req, res) => {
    const name = req.params.filename;
    if (!name || path.basename(name) !== name || name.includes('/') || name.includes('\\') || name.includes('..')) return res.status(400).json({ error: 'Invalid asset filename' });
    try {
        await fs.rm(path.join(getGlobalImageAssetsDir(), name), { force: true });
        res.json({ ok: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});
export default router;
