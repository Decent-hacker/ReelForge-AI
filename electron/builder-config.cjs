// electron-builder v26 configuration. Runtime binaries/models remain explicit external prerequisites.
module.exports={
  appId:'com.reelforge.ai',productName:'ReelForge AI',asar:false,
  directories:{output:'artifacts/windows'},
  files:['dist/**/*','electron/**/*.cjs','engine/**/*.mjs','providers/**/*.mjs','server/**/*.mjs','backend/speech_worker.py','backend/requirements.txt','composition/Root.jsx','composition/package.json','README.md','THIRD_PARTY_NOTICES.md','WINDOWS_SETUP.md','package.json','!**/.env*','!data/**/*','!artifacts/**/*','!tools/**/*'],
  win:{target:[{target:'nsis',arch:['x64']}]},
  nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false},
  publish:null
};
