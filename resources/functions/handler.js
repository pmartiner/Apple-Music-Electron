const {
        app,
        Menu,
        ipcMain,
        shell,
        dialog,
        Notification,
        BrowserWindow,
        systemPreferences,
        nativeTheme,
        clipboard
    } = require('electron'),
    {join, resolve} = require('path'),
    {readFile, readFileSync, existsSync, watch} = require('fs'),
    { loadAdBlocker } = require('./plugins/adblocker');

const regedit = require('regedit');

const handler = {

    LaunchHandler: () => {
        // Version Fetch
        if (app.commandLine.hasSwitch('version') || app.commandLine.hasSwitch('v')) {
            console.log(app.getVersion())
            app.exit()
        }

        // Verbose Check
        if (app.commandLine.hasSwitch('verbose')) {
            console.log("[Apple-Music-Electron] User has launched the application with --verbose");
        }

        // Log File Location
        if (app.commandLine.hasSwitch('log') || app.commandLine.hasSwitch('l')) {
            console.log(join(app.getPath('userData'), 'logs'))
            app.exit()
        }
    },

    InstanceHandler: () => {
        console.verbose('[InstanceHandler] Started.')

        app.on('second-instance', (_e, argv) => {
            console.warn(`[InstanceHandler][SecondInstanceHandler] Second Instance Started with args: [${argv.join(', ')}]`)

            // Checks if first instance is authorized and if second instance has protocol args
            argv.forEach((value) => {
                if (value.includes('ame://') || value.includes('itms://') || value.includes('itmss://') || value.includes('musics://') || value.includes('music://')) {
                    console.warn(`[InstanceHandler][SecondInstanceHandler] Found Protocol!`)
                    handler.LinkHandler(value);
                }
            })

            if (argv.includes("--force-quit")) {
                console.warn('[InstanceHandler][SecondInstanceHandler] Force Quit found. Quitting App.');
                app.isQuiting = true
                app.quit()
            } else if (app.win && !app.cfg.get('advanced.allowMultipleInstances')) { // If a Second Instance has Been Started
                console.warn('[InstanceHandler][SecondInstanceHandler] Showing window.');
                app.win.show()
                app.win.focus()
            }
        })

        if (!app.requestSingleInstanceLock() && !app.cfg.get('advanced.allowMultipleInstances')) {
            console.warn("[InstanceHandler] Existing Instance is Blocking Second Instance.");
            app.quit();
            app.isQuiting = true
        }
    },

    PlaybackStateHandler: () => {
        console.verbose('[playbackStateDidChange] Started.');

        ipcMain.on('playbackStateDidChange', (_event, a) => {
            console.verbose('[handler] playbackStateDidChange received.');
            app.media = a;

            app.ame.win.SetButtons()
            app.ame.win.SetTrayTooltip(a)
            app.ame.discord.updateActivity(a)
            app.ame.lastfm.scrobbleSong(a)
            app.ame.lastfm.updateNowPlayingSong(a)
            app.ame.mpris.updateState(a)
        });
    },

    MediaStateHandler: () => {
        console.verbose('[MediaStateHandler] Started.');

        ipcMain.on('nowPlayingItemDidChange', (_event, a) => {
            console.verbose('[handler] nowPlayingItemDidChange received.');
            app.media = a;

            app.ame.win.CreateNotification(a);
            app.ame.mpris.updateActivity(a);

            if (app.cfg.get('audio.seamlessAudioTransitions')) {
                app.ame.win.SetButtons()
                app.ame.win.SetTrayTooltip(a)
                app.ame.discord.updateActivity(a)
                app.ame.lastfm.scrobbleSong(a)
                app.ame.lastfm.updateNowPlayingSong(a)
                app.ame.mpris.updateState(a)
            }
        });
    },

    WindowStateHandler: () => {
        console.verbose('[WindowStateHandler] Started.');

        app.win.webContents.setWindowOpenHandler(({url}) => {
            shell.openExternal(url).then(() => console.log(`[WindowStateHandler] User has opened ${url} which has been redirected to browser.`));
            return {
                action: 'deny'
            }
        })

        let incognitoNotification;
        app.win.webContents.on('did-finish-load', () => {
            console.verbose('[did-finish-load] Completed.');
            app.ame.load.LoadOneTimeFiles();
            app.win.webContents.setZoomFactor(parseFloat(app.cfg.get("visual.scaling")))
            if (app.cfg.get('general.incognitoMode') && !incognitoNotification) {
                incognitoNotification = new Notification({
                    title: 'Incognito Mode Enabled',
                    body: `Listening activity is hidden.`,
                    icon: join(__dirname, '../icons/icon.png')
                })
                incognitoNotification.show()
            }
        });

        app.win.webContents.on('did-fail-load', (event, errCode, errDesc, url, mainFrame) => {
            console.error(`Error Code: ${errCode}\nLoading: ${url}\n${errDesc}`)
            if (mainFrame) {
                app.exit()
            }
        });

        // Windows specific: Handles window states
        // Needed because Aero Snap events do not send the same way as clicking the frame buttons.
        if (process.platform === "win32" && app.cfg.get('visual.frameType') !== 'mac' || app.cfg.get('visual.frameType') !== 'mac-right') {
            var WND_STATE = {
                MINIMIZED: 0,
                NORMAL: 1,
                MAXIMIZED: 2,
                FULL_SCREEN: 3
            }
            var wndState = WND_STATE.NORMAL

            app.win.on("resize", (_event) => {
                const isMaximized = app.win.isMaximized()
                const isMinimized = app.win.isMinimized()
                const isFullScreen = app.win.isFullScreen()
                const state = wndState;
                if (isMinimized && state !== WND_STATE.MINIMIZED) {
                    wndState = WND_STATE.MINIMIZED
                } else if (isFullScreen && state !== WND_STATE.FULL_SCREEN) {
                    wndState = WND_STATE.FULL_SCREEN
                } else if (isMaximized && state !== WND_STATE.MAXIMIZED) {
                    wndState = WND_STATE.MAXIMIZED
                    app.win.webContents.executeJavaScript(`document.querySelector("#maximize").classList.add("maxed")`)
                } else if (state !== WND_STATE.NORMAL) {
                    wndState = WND_STATE.NORMAL
                    app.win.webContents.executeJavaScript(`document.querySelector("#maximize").classList.remove("maxed")`)
                }
            })
        }

        app.win.on('unresponsive', () => {
            dialog.showMessageBox({
                message: `${app.getName()} has become unresponsive`,
                title: 'Do you want to try forcefully reloading the app?',
                buttons: ['Yes', 'Quit', 'No'],
                cancelId: 1
            }).then(({response}) => {
                if (response === 0) {
                    app.win.contents.forcefullyCrashRenderer()
                    app.win.contents.reload()
                } else if (response === 1) {
                    console.log("[WindowStateHandler] Application has become unresponsive and has been closed.")
                    app.exit();
                }
            })
        })

        app.win.on('page-title-updated', (event, title) => {
            console.verbose(`[page-title-updated] Title updated Running necessary files. ('${title}')`)
            app.ame.load.LoadFiles();
        })

        app.win.on('close', (e) => {
            if (!app.isQuiting) {
                if (app.isMiniplayerActive) {
                    ipcMain.emit("set-miniplayer", false);
                    e.preventDefault()
                } else if (app.cfg.get('window.closeButtonMinimize') || process.platform === "darwin") {
                    app.win.hide()
                    e.preventDefault()
                }
            } else {
                app.win.destroy()
                if (app.lyrics.mxmWin) {
                    app.lyrics.mxmWin.destroy();
                }
                if (app.lyrics.neteaseWin) {
                    app.lyrics.neteaseWin.destroy();
                }
            }
        })

        app.win.on('maximize', (e) => {
            if (app.isMiniplayerActive) {
                e.preventDefault()
            }
        })

        app.win.on('show', () => {
            app.ame.win.SetContextMenu(true)
            app.ame.win.SetButtons()
            if (app.win.isVisible()) {
                app.win.focus()
            }
        });

        app.win.on('hide', () => {
            app.ame.win.SetContextMenu(false)
            if (app.pluginsEnabled) {
                app.win.webContents.executeJavaScript(`_plugins.execute('OnHide')`)
            }
        });
    },

    SettingsHandler: () => {
        console.verbose('[SettingsHandler] Started.');
        let DialogMessage = false,
            storedChanges = [],
            handledConfigs = [];

        systemPreferences.on('accent-color-changed', (event, color) => {
            if (color && app.cfg.get('visual.useOperatingSystemAccent') && (process.platform === "win32" || process.platform === "darwin")) {
                const accent = '#' + color.slice(0, -2)
                app.win.webContents.insertCSS(`
                :root {
                    --keyColor: ${accent} !important;
                    --systemAccentBG: ${accent} !important;
                    --systemAccentBG-pressed: rgba(${app.ame.utils.hexToRgb(accent).r}, ${app.ame.utils.hexToRgb(accent).g}, ${app.ame.utils.hexToRgb(accent).b}, 0.75) !important;
                    --keyColor-rgb: ${app.ame.utils.hexToRgb(accent).r} ${app.ame.utils.hexToRgb(accent).g} ${app.ame.utils.hexToRgb(accent).b} !important;
                }`).then((key) => {
                    app.injectedCSS['useOperatingSystemAccent'] = key
                })
            }
        })

        /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        *  Restart Required Configuration Handling
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */

        app.cfg.onDidAnyChange((newConfig, oldConfig) => {
            let currentChanges = [];

            for (const [categoryTitle, categoryContents] of Object.entries(newConfig)) {
                if (categoryContents !== oldConfig[categoryTitle]) { // This has gotten the changed category
                    for (const [settingTitle, settingValue] of Object.entries(newConfig[categoryTitle])) {
                        if (JSON.stringify(settingValue) !== JSON.stringify(oldConfig[categoryTitle][settingTitle])) {
                            currentChanges.push(`${categoryTitle}.${settingTitle}`)
                            if (!storedChanges.includes(`${categoryTitle}.${settingTitle}`)) {
                                storedChanges.push(`${categoryTitle}.${settingTitle}`)
                            }
                        }
                    }
                }
            }

            console.verbose(`[SettingsHandler] Found changes: ${currentChanges} | Total Changes: ${storedChanges}`);

            if (!DialogMessage && !currentChanges.includes('tokens.lastfm') && !currentChanges.includes('window.closeButtonMinimize') && !handledConfigs.includes(currentChanges[0])) {
                DialogMessage = dialog.showMessageBox({
                    title: "Relaunch Required",
                    message: "A relaunch is required in order for the settings you have changed to apply.",
                    type: "warning",
                    buttons: ['Relaunch Now', 'Relaunch Later']
                }).then(({response}) => {
                    if (response === 0) {
                        app.relaunch()
                        app.quit()
                    }
                })
            }
        })

        /* ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        *  Individually Handled Configuration Options
        ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ */
        handledConfigs.push('advanced.devToolsOnStartup', 'general.storefront', 'tokens.lastfm') // Stuff for the restart to just ignore

        // Theme Changes
        handledConfigs.push('visual.theme');
        app.cfg.onDidChange('visual.theme', (newValue, _oldValue) => {
            app.win.webContents.executeJavaScript(`AMStyling.loadTheme("${(newValue === 'default' || !newValue) ? '' : newValue}");`).catch((e) => console.error(e));
            if (app.watcher) {
                app.watcher.close();
                console.verbose('[Watcher] Removed old watcher.')
            }

            if (existsSync(resolve(app.getPath('userData'), 'themes', `${newValue}.css`)) && newValue !== "default" && newValue) {
                app.watcher = watch(resolve(app.getPath('userData'), 'themes', `${newValue}.css`), (event, fileName) => {
                    if (event === "change" && fileName === `${newValue}.css`) {
                        app.win.webContents.executeJavaScript(`AMStyling.loadTheme("${newValue}", true);`).catch((err) => console.error(err));
                    }
                });
                console.verbose(`[Watcher] Watching for changes: 'themes/${newValue}.css'`)
            }

            const updatedVibrancy = app.ame.utils.fetchTransparencyOptions();
            if (app.transparency && updatedVibrancy && process.platform !== 'darwin') app.win.setVibrancy(updatedVibrancy);
        })

        // Transparency Changes
        handledConfigs.push('visual.transparencyEffect', 'visual.transparencyTheme', 'visual.transparencyDisableBlur', 'visual.transparencyMaximumRefreshRate');
        app.cfg.onDidChange('visual.transparencyEffect' || 'visual.transparencyTheme' || 'visual.transparencyDisableBlur' || 'visual.transparencyMaximumRefreshRate', (_newValue, _oldValue) => {
            const updatedVibrancy = app.ame.utils.fetchTransparencyOptions()
            if (app.cfg.get("visual.transparencyEffect") === "mica" && process.platform !== 'darwin') {
                app.win.webContents.executeJavaScript(`AMStyling.setMica(true);`).catch((e) => console.error(e));
                app.transparency = false;
                app.win.setVibrancy();
            }else{
                app.win.webContents.executeJavaScript(`AMStyling.setMica(false);`).catch((e) => console.error(e));
            }
            if (app.transparency && updatedVibrancy && process.platform !== 'darwin') {
                app.win.setVibrancy(updatedVibrancy);
                app.win.webContents.executeJavaScript(`AMStyling.setTransparency(true);`).catch((e) => console.error(e));
            } else {
                app.win.setVibrancy();
                app.win.webContents.executeJavaScript(`AMStyling.setTransparency(false);`).catch((e) => console.error(e));
            }
        })

        // Reload scripts
        handledConfigs.push('visual.removeUpsell', 'visual.removeAppleLogo', 'visual.removeFooter', 'visual.useOperatingSystemAccent');
        app.cfg.onDidChange('visual.removeUpsell', (newValue, _oldValue) => {
            app.ame.load.LoadFiles();
        })
        app.cfg.onDidChange('visual.removeAppleLogo', (newValue, _oldValue) => {
            app.ame.load.LoadFiles();
        })
        app.cfg.onDidChange('visual.removeFooter', (newValue, _oldValue) => {
            app.ame.load.LoadFiles();
        })
        app.cfg.onDidChange('visual.useOperatingSystemAccent', (newValue, _oldValue) => {
            if (!newValue) {
                app.ame.win.removeInsertedCSS('useOperatingSystemAccent')
            } else {
                app.ame.load.LoadFiles();
            }
        })


        // IncognitoMode Changes
        handledConfigs.push('general.incognitoMode');
        app.cfg.onDidChange('general.incognitoMode', (newValue, _oldValue) => {
            if (newValue) {
                console.log("[Incognito] Incognito Mode enabled. DiscordRPC and LastFM updates are ignored.")
            }
        })

        // Scaling Changes
        handledConfigs.push('visual.scaling');
        app.cfg.onDidChange('visual.scaling', (newValue, _oldValue) => {
            app.win.webContents.setZoomFactor(parseFloat(newValue))
        });

        // Mode Changes
        handledConfigs.push('advanced.forceApplicationMode');
        app.cfg.onDidChange('advanced.forceApplicationMode', (newValue, _oldValue) => {
            nativeTheme.themeSource = newValue;
        });
    },

    RendererListenerHandlers: () => {

        // Showing the OOBE on first launch
        ipcMain.on('showOOBE', (event) => {
            event.returnValue = app.ame.showOOBE;
            app.ame.showOOBE = false
        })

        // Themes Listing Update
        ipcMain.handle('updateThemesListing', (_event) => {
            return app.ame.utils.fetchThemesListing();
        })

        // Plugins Listing Update
        ipcMain.handle('fetchPluginsListing', (_event) => {
            return app.ame.utils.fetchPluginsListing();
        })

        // Get OS
        ipcMain.handle('fetchOperatingSystem', () => {
            return process.platform
        })

        // Acrylic Check
        ipcMain.handle('isAcrylicSupported', (_event) => {
            return app.ame.utils.isAcrylicSupported();
        })

        // Electron-Store Renderer Handling for Getting Values
        ipcMain.handle('getStoreValue', (event, key, defaultValue) => {
            return (defaultValue ? app.cfg.get(key, true) : app.cfg.get(key));
        });

        // Electron-Store Renderer Handling for Setting Values
        ipcMain.handle('setStoreValue', (event, key, value) => {
            app.cfg.set(key, value);
        });

        ipcMain.handle('themeFileExists', (event, fileName) => {
            return existsSync(resolve(app.getPath('userData'), 'themes', `${fileName}.css`))
        });

        // Copy Log File
        ipcMain.on('copyLogFile', (event) => {
            const data = readFileSync(app.log.transports.file.getFile().path, {encoding: 'utf8', flag: 'r'});
            clipboard.writeText(data)
            event.returnValue = true
        });

        // Electron-Store Renderer Handling for Getting Configuration
        ipcMain.on('getStore', (event) => {
            event.returnValue = app.cfg.store
        })

        // Electron-Store Renderer Handling for Setting Configuration
        ipcMain.on('setStore', (event, store) => {
            app.cfg.store = store
        })

        // Update Themes
        ipcMain.handle('updateThemes',  () => {
            return app.ame.utils.updateThemes()
        });

        // Authorization (This needs to be cleaned up a bit, an alternative to reload() would be good )
        ipcMain.on('authorizationStatusDidChange', (_event, authorized) => {
            console.log(`authorization updated. status: ${authorized}`)
            app.win.reload()
            app.ame.load.LoadFiles()
            app.isAuthorized = (authorized === 3)
        })

        // Window Navigation - Minimize
        ipcMain.on('minimize', () => { // listen for minimize event
            if (typeof app.win.minimize === 'function') {
                app.win.minimize()
            }
        });

        // Window Navigation - Maximize
        ipcMain.on('maximize', () => { // listen for maximize event and perform restore/maximize depending on window state

            if (app.win.isMaximized()) {
                app.win.unmaximize()
                if (process.platform !== "win32") {
                    app.win.webContents.executeJavaScript(`document.querySelector("#maximize").classList.remove("maxed")`)
                }
            } else {
                app.win.maximize()
                if (process.platform !== "win32") {
                    app.win.webContents.executeJavaScript(`document.querySelector("#maximize").classList.add("maxed")`)
                }
            }
        })

        // Window Navigation - Close
        ipcMain.on('close', () => { // listen for close event
            app.win.close();
        })

        // Window Navigation - Back
        ipcMain.on('back', () => { // listen for back event
            if (app.win.webContents.canGoBack()) {
                app.win.webContents.goBack()
            }
        })

        // Window Navigation - Resize
        ipcMain.on("resize-window", (event, width, height) => {
            app.win.setSize(width, height)
        })

        // miniPlayer
        const minSize = app.win.getMinimumSize()
        ipcMain.on("set-miniplayer", (event, val) => {
            if (val) {
                app.isMiniplayerActive = true;
                app.win.setSize(300, 300);
                app.win.setMinimumSize(300, 55);
                app.win.setMaximumSize(300, 300);
                app.win.maximizable = false;
                app.win.webContents.executeJavaScript("_miniPlayer.setMiniPlayer(true)").catch((e) => console.error(e));
                if (app.win.isMaximized) {
                    app.win.unmaximize();
                }
            } else {
                app.isMiniplayerActive = false;
                app.win.setMaximumSize(9999, 9999);
                app.win.setMinimumSize(minSize[0], minSize[1]);
                app.win.setSize(1024, 600);
                app.win.maximizable = true;
                app.win.webContents.executeJavaScript("_miniPlayer.setMiniPlayer(false)").catch((e) => console.error(e));
            }
        })

        ipcMain.on("show-miniplayer-menu", () => {
            const menuOptions = [{
                type: "checkbox",
                label: "Always On Top",
                click: () => {
                    if (app.win.isAlwaysOnTop()) {
                        app.win.setAlwaysOnTop(false, 'screen')
                    } else {
                        app.win.setAlwaysOnTop(true, 'screen')
                    }
                },
                checked: app.win.isAlwaysOnTop()
            }, {
                label: "Exit Mini Player",
                click: () => {
                    ipcMain.emit("set-miniplayer", false)
                }
            }]
            const menu = Menu.buildFromTemplate(menuOptions)
            menu.popup(app.win)
        })

        ipcMain.on("alwaysOnTop", (event, val) => {
            if (val) {
                app.win.setAlwaysOnTop(true, 'screen')
            } else {
                app.win.setAlwaysOnTop(false, 'screen')
            }
        })

        ipcMain.on("load-plugin", (event, plugin) => {
            let path = join(app.userPluginsPath, plugin.toLowerCase() + ".js")
            readFile(path, "utf-8", (error, data) => {
                if (!error) {
                    try {
                        app.win.webContents.executeJavaScript(data).then(() => {
                            console.verbose(`[Plugins] Injected Plugin`)
                        })
                    } catch (err) {
                        console.error(`[Plugins] error injecting plugin: ${path} - Error: ${err}`)
                    }
                } else {
                    console.error(`[Plugins] error reading plugin: ${path} - Error: ${error}`)
                }
            })
        })

        // Get Wallpaper
        ipcMain.on("get-wallpaper", (event) => {
            function base64_encode(file) {
                const bitmap = readFileSync(file)
                return `data:image/png;base64,${Buffer.from(bitmap).toString('base64')}`
            }

            regedit.list(`HKCU\\Control Panel\\Desktop\\`, (err, result) => {
                var path = (result['HKCU\\Control Panel\\Desktop\\\\']['values']['WallPaper']['value'])
                event.returnValue = base64_encode(path)
            })
        })

        ipcMain.on("get-wallpaper-style", (event) => {
            regedit.list(`HKCU\\Control Panel\\Desktop\\`, (err, result) => {
                var value = (result['HKCU\\Control Panel\\Desktop\\\\']['values']['WallpaperStyle']['value'])
                event.returnValue = parseInt(value)
            })
        })

        // Set BrowserWindow zoom factor
        ipcMain.on("set-zoom-factor", (event, factor) => {
            app.win.webContents.setZoomFactor(factor)
        })

    },

    LinkHandler: (startArgs) => {
        if (!startArgs || !app.win || !app.isAuthorized) return;


        if (String(startArgs).includes('auth')) {
            let authURI = String(startArgs).split('/auth/')[1]
            if (authURI.startsWith('lastfm')) { // If we wanted more auth options
                const authKey = authURI.split('lastfm?token=')[1];
                app.cfg.set('general.lastfm', true);
                app.cfg.set('tokens.lastfm', authKey);
                app.win.webContents.send('LastfmAuthenticated', authKey);
                app.ame.lastfm.authenticate()
            }
        } else {
            if (!app.isAuthorized) return
            const formattedSongID = startArgs.replace('ame://', '').replace('/', '');
            console.warn(`[LinkHandler] Attempting to load song id: ${formattedSongID}`);

            // setQueue can be done with album, song, url, playlist id
            app.win.webContents.executeJavaScript(`
                MusicKit.getInstance().setQueue({ song: '${formattedSongID}'}).then(function(queue) {
                    MusicKit.getInstance().play();
                });
            `).catch((err) => console.error(err));
        }

    },

    LyricsHandler: () => {
        app.lyrics = {neteaseWin: null, mxmWin: null}

        app.lyrics.neteaseWin = new BrowserWindow({
            width: 1,
            height: 1,
            show: false,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        app.lyrics.mxmWin = new BrowserWindow({
            width: 1,
            height: 1,
            show: false,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,

            }
        });

        ipcMain.on('MXMTranslation', function (event, track, artist, lang) {
            try {
                if (app.lyrics.mxmWin == null) {
                    app.lyrics.mxmWin = new BrowserWindow({
                        width: 1,
                        height: 1,
                        show: false,
                        autoHideMenuBar: true,
                        webPreferences: {
                            nodeIntegration: true,
                            contextIsolation: false,

                        }
                    });


                } else {
                    app.lyrics.mxmWin.webContents.send('mxmcors', track, artist, lang);
                }

                loadAdBlocker(app.lyrics.mxmWin);

                // try{

                // const cookie = { url: 'https://apic-desktop.musixmatch.com/', name: 'x-mxm-user-id', value: '' }
                // app.lyrics.mxmWin.webContents.session.defaultSession.cookies.set(cookie);
                // } catch (e){}
                if (!app.lyrics.mxmWin.webContents.getURL().includes('musixmatch.html')) {
                    app.lyrics.mxmWin.loadFile(join(__dirname, '../lyrics/musixmatch.html'));
                    app.lyrics.mxmWin.webContents.on('did-finish-load', () => {
                        app.lyrics.mxmWin.webContents.send('mxmcors', track, artist, lang);
                    });
                }

                app.lyrics.mxmWin.on('closed', () => {
                    app.lyrics.mxmWin = null
                });

            } catch (e) {
                console.error(e)
            }
        });

        ipcMain.on('NetEaseLyricsHandler', function (event, data) {
            try {
                if (app.lyrics.neteaseWin == null) {
                    app.lyrics.neteaseWin = new BrowserWindow({
                        width: 100,
                        height: 100,
                        show: false,
                        autoHideMenuBar: true,
                        webPreferences: {
                            nodeIntegration: true,
                            contextIsolation: false,

                        }
                    });
                    app.lyrics.neteaseWin.webContents.on('did-finish-load', () => {
                        app.lyrics.neteaseWin.webContents.send('neteasecors', data);
                    });
                } else {
                    app.lyrics.neteaseWin.webContents.on('did-finish-load', () => {
                        app.lyrics.neteaseWin.webContents.send('neteasecors', data);
                    });
                }

                loadAdBlocker(app.lyrics.neteaseWin);

                app.lyrics.neteaseWin.loadFile(join(__dirname, '../lyrics/netease.html'));
                app.lyrics.neteaseWin.on('closed', () => {
                    app.lyrics.neteaseWin = null
                });

            } catch (e) {
                console.log(e);
                app.win.send('truelyrics', '[00:00] Instrumental. / Lyrics not found.');
            }
        });

        ipcMain.on('LyricsHandler', function (event, data, artworkURL) {
            app.win.send('truelyrics', data);
            app.win.send('albumart', artworkURL);
        });

        ipcMain.on('LyricsHandlerNE', function (event, data) {
            app.win.send('truelyrics', data);
        });

        ipcMain.on('LyricsHandlerTranslation', function (event, data) {
            app.win.send('lyricstranslation', data);
        });

        ipcMain.on('LyricsTimeUpdate', function (event, data) {
            app.win.send('ProgressTimeUpdate', data);
        });

        ipcMain.on('LyricsUpdate', function (event, data, artworkURL) {
            app.win.send('truelyrics', data);
            app.win.send('albumart', artworkURL);
        });

        ipcMain.on('LyricsMXMFailed', function (_event, _data) {
            app.win.send('backuplyrics', '');
        });

        ipcMain.on('ProgressTimeUpdateFromLyrics', function (event, data) {
            app.win.webContents.executeJavaScript(`MusicKit.getInstance().seekToTime('${data}')`).catch((e) => console.error(e));
        });
    }
}

module.exports = handler
