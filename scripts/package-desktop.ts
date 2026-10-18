import {packager} from '@electron/packager';
const platform=process.platform,arch=process.arch;
if(platform!=='darwin'&&platform!=='win32'&&platform!=='linux')throw new Error('Unsupported desktop platform');
if(arch!=='arm64'&&arch!=='x64')throw new Error('Unsupported desktop architecture');
const paths=await packager({
  dir:'.',name:'Agent',out:'release',overwrite:true,
  platform,arch,electronVersion:'44.9.0',
  appBundleId:'dev.personal.agent',asar:false,prune:true,
  ignore:/^\/(?:experiments|docs|tests|scripts|apps|release|\.agent-data|\.git)(?:\/|$)|^\/(?:tsconfig.*\.json|AGENTS\.md|DECISIONS\.md)$/,
});
for(const path of paths)console.log(path);
