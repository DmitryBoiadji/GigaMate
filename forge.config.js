const {FusesPlugin} = require('@electron-forge/plugin-fuses');
const {FuseV1Options, FuseVersion} = require('@electron/fuses');

// Only these project files go into the app. An allowlist keeps local files such as .env (publish token),
// editor and agent settings, and README screenshots out of the published asar.
const APP_FILES = [
    '/package.json', '/main.js', '/preload.js',
    '/index.html', '/popup.js', '/styles.css',
    '/settings.html', '/settings.js', '/settings.css',
    '/images/iconTemplate.png', '/images/iconTemplate@2x.png', '/images/icon@2x.png'
];

function ignore(file) {
    if (!file) return false;
    if (file === '/node_modules' || file.startsWith('/node_modules/')) return false;
    if (file === '/images') return false;
    return !APP_FILES.includes(file);
}

module.exports = {
    packagerConfig: {
        asar: true,
        icon: 'images/icon',
        ignore
    },
    rebuildConfig: {
        onlyModules: [] // Skip rebuild - node-hid ships N-API prebuilds for all targets
    },
    publishers: [
        {
            name: '@electron-forge/publisher-github',
            platforms: ['darwin', 'linux', 'win32'],
            config: {
                repository: {
                    owner: 'DmitryBoiadji',
                    name: 'GigaMate'
                },
                draft: true,
                generateReleaseNotes: true,
                prerelease: true
            }
        }
    ],
    "makers": [
        {
            "name": "@electron-forge/maker-squirrel",
            "config": {
                "name": "GigaMate",
                "setupIcon": "images/icon.ico"
            }
        },
        {
            "name": "@electron-forge/maker-zip",
            "platforms": [
                "darwin",
                "linux"
            ]
        },
        {
            "name": "@electron-forge/maker-deb",
            "config": {options: {icon: 'images/logo.png'}}
        },
        {
            "name": "@electron-forge/maker-rpm",
            "config": {options: {icon: 'images/logo.png'}}
        }
    ],
    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {},
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
            // The UI is loaded with loadFile and needs no extra file:// privileges
            [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
        }),
    ],
};
