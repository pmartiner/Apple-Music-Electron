const {readFile} = require('fs')
const {app} = require('electron')
const {join} = require('path')
const Sentry = require('@sentry/electron');
if (app.preferences.value('general.analyticsEnabled').includes(true)) {
    Sentry.init({ dsn: "https://20e1c34b19d54dfcb8231e3ef7975240@o954055.ingest.sentry.io/5903033" });
}

exports.LoadCSS = function (path, theme) {
    if (theme) {
        path = join(app.ThemesFolderPath, path.toLowerCase());
    } else {
        path = join(join(__dirname, '../../css/'), path)
    }


    readFile(path, "utf-8", function (error, data) {
        if (!error) {
            let formattedData = data.replace(/\s{2,10}/g, ' ').trim();
            app.win.webContents.insertCSS(formattedData).then(() => console.log(`[Themes] '${path}' successfully injected.`));
        } else {
            console.error(`[LoadTheme] Error while injecting: '${path}' - Error: ${error}`)
        }
    });
}