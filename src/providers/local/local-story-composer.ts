import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ExecutionError } from '../../core/errors.js';

const execFileAsync = promisify(execFile);

export type StoryTemplateId = 'PHOTO_ONLY' | 'EDITORIAL_TEXT' | 'EVENT_CTA';
export interface LocalStoryComposeInput { readonly storyCreativeId:string; readonly contentItemId:string; readonly masterAssetId:string; readonly masterDriveFileId:string; readonly imageBytes:Uint8Array; readonly contentType:'image/jpeg'|'image/png'|'image/webp'; readonly templateId:StoryTemplateId; readonly message?:string; readonly cta?:string; readonly brandLabel?:string; }
export interface LocalStoryComposeResult { readonly storyCreativeId:string; readonly contentItemId:string; readonly masterAssetId:string; readonly masterDriveFileId:string; readonly masterSha256:string; readonly outputSha256:string; readonly sourceImageBound:true; readonly editorProvider:'LOCAL_IMAGEMAGICK'; readonly pipelineVersion:'local-story-composer-v1'; readonly dimensions:'1080x1920'; readonly aspectRatio:'9:16'; readonly templateId:StoryTemplateId; readonly outputContentType:'image/jpeg'; readonly outputBytes:Uint8Array; readonly storyReady:true; }
export type LocalStoryComposerCommandRunner=(command:string,args:readonly string[])=>Promise<void>;

export class LocalStoryComposer {
  constructor(private readonly commandRunner:LocalStoryComposerCommandRunner=defaultCommandRunner,private readonly binary=process.env.IMAGE_MAGICK_CONVERT_BINARY?.trim()||'convert'){}
  async compose(input:LocalStoryComposeInput):Promise<LocalStoryComposeResult>{
    validateInput(input); const workspace=await mkdtemp(join(tmpdir(),'toca-story-composer-')); const sourcePath=join(workspace,`master${extensionFor(input.contentType)}`); const outputPath=join(workspace,'story.jpg');
    try { await writeFile(sourcePath,input.imageBytes); await this.commandRunner(this.binary,buildCommandArgs(input,sourcePath,outputPath)); const outputBytes=await readFile(outputPath); if(outputBytes.byteLength===0||!isJpeg(outputBytes)) throw new ExecutionError('QUALITY_GATE_FAILED','LOCAL_STORY_COMPOSER_OUTPUT_INVALID',false); return {storyCreativeId:input.storyCreativeId,contentItemId:input.contentItemId,masterAssetId:input.masterAssetId,masterDriveFileId:input.masterDriveFileId,masterSha256:sha256(input.imageBytes),outputSha256:sha256(outputBytes),sourceImageBound:true,editorProvider:'LOCAL_IMAGEMAGICK',pipelineVersion:'local-story-composer-v1',dimensions:'1080x1920',aspectRatio:'9:16',templateId:input.templateId,outputContentType:'image/jpeg',outputBytes,storyReady:true}; }
    catch(error){ if(error instanceof ExecutionError) throw error; const code=(error as NodeJS.ErrnoException)?.code; if(code==='ENOENT') throw new ExecutionError('CAPABILITY_UNAVAILABLE',`LOCAL_STORY_COMPOSER_BINARY_UNAVAILABLE:${this.binary}`,false); throw new ExecutionError('PROVIDER_UNAVAILABLE',`LOCAL_STORY_COMPOSER_FAILED:${error instanceof Error?error.message:String(error)}`,true); }
    finally { await rm(workspace,{recursive:true,force:true}); }
  }
}

function buildCommandArgs(input:LocalStoryComposeInput,sourcePath:string,outputPath:string):string[]{
  const args=[sourcePath,'-auto-orient','-colorspace','sRGB','-filter','Lanczos','-resize','1080x1920^','-gravity','center','-extent','1080x1920'];
  if(input.templateId!=='PHOTO_ONLY'){
    args.push('-fill','rgba(0,0,0,0.48)','-draw','rectangle 0,1250 1080,1920','(','-size','936x250','-background','none','-font','DejaVu-Sans','-fill','white','-pointsize',input.templateId==='EVENT_CTA'?'56':'52',`caption:${input.message?.trim()??''}`,')','-gravity','southwest','-geometry','+72+250','-composite');
    if(input.cta?.trim()) args.push('(','-size','936x90','-background','none','-font','DejaVu-Sans','-fill','white','-pointsize','34',`caption:${input.cta.trim()}`,')','-gravity','southwest','-geometry','+72+90','-composite');
    args.push('-font','DejaVu-Sans','-fill','white','-gravity','northwest','-pointsize','28','-annotate','+72+72',(input.brandLabel?.trim()||'TOCA DO MORCEGO').toUpperCase());
  }
  args.push('-quality','95','-define','jpeg:dct-method=float',outputPath); return args;
}
async function defaultCommandRunner(command:string,args:readonly string[]):Promise<void>{await execFileAsync(command,[...args],{maxBuffer:1024*1024});}
function validateInput(input:LocalStoryComposeInput):void{if(!input.storyCreativeId.trim()||!input.contentItemId.trim()||!input.masterAssetId.trim()||!input.masterDriveFileId.trim()) throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE','LOCAL_STORY_COMPOSER_LINEAGE_REQUIRED',false); if(input.imageBytes.byteLength===0) throw new ExecutionError('SOURCE_IMAGE_BINDING_FAILURE','LOCAL_STORY_COMPOSER_MASTER_BYTES_REQUIRED',false); if(input.templateId!=='PHOTO_ONLY'&&!input.message?.trim()) throw new ExecutionError('QUALITY_GATE_FAILED','LOCAL_STORY_COMPOSER_MESSAGE_REQUIRED',false); if((input.message?.trim().length??0)>90||(input.cta?.trim().length??0)>60) throw new ExecutionError('QUALITY_GATE_FAILED','LOCAL_STORY_COMPOSER_TEXT_TOO_LONG',false);}
function extensionFor(contentType:LocalStoryComposeInput['contentType']):string{if(contentType==='image/png')return '.png';if(contentType==='image/webp')return '.webp';return '.jpg';}
function sha256(bytes:Uint8Array):string{return createHash('sha256').update(bytes).digest('hex');}
function isJpeg(bytes:Uint8Array):boolean{return bytes.byteLength>=4&&bytes[0]===0xff&&bytes[1]===0xd8;}
