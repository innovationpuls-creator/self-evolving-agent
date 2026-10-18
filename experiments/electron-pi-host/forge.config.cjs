module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "pi-electron-host",
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "win32"],
    },
  ],
};
