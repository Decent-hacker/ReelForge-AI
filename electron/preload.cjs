const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('reelforge',{desktop:true,pickTool:key=>ipcRenderer.invoke('pick-tool',key),exportVideo:id=>ipcRenderer.invoke('export-video',id)});
