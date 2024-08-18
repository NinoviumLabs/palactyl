/**
 *      __         ___            __        __
 *     / /_  ___  / (_)___ ______/ /___  __/ /
 *    / __ \/ _ \/ / / __ `/ ___/ __/ / / / / 
 *   / / / /  __/ / / /_/ / /__/ /_/ /_/ / /  
 *  /_/ /_/\___/_/_/\__,_/\___/\__/\__, /_/   
 *                               /____/      
 * 
 *     Heliactyl 18.0.0 (Ironclad Ridge)
 * 
 */

"use strict";

// Load logging.
require("./handlers/console.js")();

// Load packages.
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const chalk = require("chalk");
const axios = require("axios");
const arciotext = require("./handlers/afk.js");
const cluster = require("cluster");
const os = require("os");
const ejs = require("ejs");
const readline = require("readline");
const chokidar = require('chokidar');

global.Buffer = global.Buffer || require("buffer").Buffer;

if (typeof btoa === "undefined") {
  global.btoa = function (str) {
    return Buffer.from(str, "binary").toString("base64");
  };
}
if (typeof atob === "undefined") {
  global.atob = function (b64Encoded) {
    return Buffer.from(b64Encoded, "base64").toString("binary");
  };
}

// Load settings.
const loadConfig = require("./handlers/config");
const settings = loadConfig("./config.toml");


const defaultthemesettings = {
  index: "index.ejs",
  notfound: "index.ejs",
  redirect: {},
  pages: {},
  mustbeloggedin: [],
  mustbeadmin: [],
  variables: {},
};

/**
 * Renders data for the theme.
 * @param {Object} req - The request object.
 * @param {Object} theme - The theme object.
 * @returns {Promise<Object>} The rendered data.
 */
async function renderdataeval(req, theme) {
  const JavaScriptObfuscator = require('javascript-obfuscator');
  let renderdata = {
    req: req,
    settings: settings,
    userinfo: req.session.userinfo,
    packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) ? await db.get("package-" + req.session.userinfo.id) : settings.api.client.packages.default : null,
    extraresources: !req.session.userinfo ? null : (await db.get("extra-" + req.session.userinfo.id) ? await db.get("extra-" + req.session.userinfo.id) : {
      ram: 0,
      disk: 0,
      cpu: 0,
      servers: 0
    }),
    packages: req.session.userinfo ? settings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) ? await db.get("package-" + req.session.userinfo.id) : settings.api.client.packages.default] : null,
    coins: settings.api.client.coins.enabled == true ? (req.session.userinfo ? (await db.get("coins-" + req.session.userinfo.id) ? await db.get("coins-" + req.session.userinfo.id) : 0) : null) : null,
    bal: (req.session.userinfo ? (await db.get("bal-" + req.session.userinfo.id) ? await db.get("bal-" + req.session.userinfo.id) : 0) : null),
    pterodactyl: req.session.pterodactyl,
    extra: theme.settings.variables,
    db: db,
    workerId: workerIds[cluster.worker.id] // Add the worker ID here
  };
  renderdata.arcioafktext = JavaScriptObfuscator.obfuscate(`
    let everywhat = ${settings.api.afk.every};
    let gaincoins = ${settings.api.afk.coins};
    let wspath = "ws";

    ${arciotext}
  `).getObfuscatedCode();
  return renderdata;
}

module.exports.renderdataeval = renderdataeval;

// Load database
const Database = require("keyv");
const db = new Database(settings.database);

module.exports.db = db;

// Helper function to generate random 6-character IDs
function generateRandomId(length = 6) {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const workerIds = {};

if (cluster.isMaster) {
  // Display ASCII art and loading spinner
  const asciiArt = fs.readFileSync('./handlers/ascii.txt', 'utf8');
  console.log('\n' + asciiArt + '\n');

  let spinnerFrames = ['-', '\\', '|', '/'];
  let currentFrame = 0;
  
  const spinner = setInterval(() => {
    process.stdout.write(chalk.gray('\r' + spinnerFrames[currentFrame++] + ' Working on it...'));
    currentFrame %= spinnerFrames.length;
  }, 100);
  
  setTimeout(() => {
    clearInterval(spinner);
    process.stdout.write('\r');
    startApp();
  }, 3000);

  function startApp() {
    // Create tree view of modules in /modules/
    let moduleFiles = fs.readdirSync("./modules").filter((file) => file.endsWith(".js"));
    const settingsVersion = settings.version;
  
    console.log(chalk.gray("Loading modules tree..."));
    console.log(chalk.gray("Version: " + settingsVersion));

    let modulesTable = [];

    moduleFiles.forEach(file => {
      const module = require('./modules/' + file);
      if (!module.load || !module.heliactylModule) {
        modulesTable.push({ File: file, Status: 'No module information', 'Target Platform': 'Unknown' });
        return;
      }
    
      const { name, target_platform } = module.heliactylModule;
  
      modulesTable.push({ File: file, Name: name, Status: 'Module loaded!', 'Target Platform': target_platform });
    });

    console.table(modulesTable);
  
    const numCPUs = settings.clusters;
    console.log(chalk.gray('Starting workers on Heliactyl ' + settings.version));
    console.log(chalk.gray(`Master ${process.pid} is running`));
    console.log(chalk.gray(`Forking ${numCPUs} workers...`));
  
    if (numCPUs > 48 || numCPUs < 1) {
      console.log(chalk.red('Error: Clusters amount was either below 1, or above 48.'))
      process.exit()
    }

    for (let i = 0; i < numCPUs; i++) {
      const worker = cluster.fork();
      const workerId = generateRandomId();
      workerIds[worker.id] = workerId; // Store the worker ID
    }
  
    cluster.on('exit', (worker, code, signal) => {
      console.log(chalk.red(`Worker ${worker.process.pid} died. Forking a new worker...`));
      const newWorker = cluster.fork();
      const workerId = generateRandomId();
      workerIds[newWorker.id] = workerId; // Assign new ID for the new worker
    });
    
    // Watch for file changes and reboot workers
    const watcher = chokidar.watch('./modules');
    const watcher2 = chokidar.watch('./config.toml');
    watcher.on('change', (path) => {
      console.log(chalk.yellow(`File changed: ${path}. Rebooting workers...`));
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
    });
    watcher2.on('change', (path) => {
      console.log(chalk.yellow(`File changed: ${path}. Rebooting workers...`));
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
    });
  }
  
  cluster.on('online', (worker) => {
    const workerTree = Object.values(cluster.workers).map(worker => ({
      id: worker.id,
      pid: worker.process.pid,
      state: worker.state,
      workerId: workerIds[worker.id] // Include the worker ID in the table
    }));
    console.log(chalk.gray('Current workers status:'));
    console.table(workerTree);
  });

} else {
  // Load websites.
  const express = require("express");
  const app = express();
  app.set('view engine', 'ejs');
  require("express-ws")(app);

  // Load express addons.
  const session = require("express-session");
  const SessionStore = require("./handlers/session");
  const indexjs = require("./app.js");

  // Load the website.
  module.exports.app = app;

  app.use((req, res, next) => {
    res.setHeader("X-Powered-By", "Zen - UI10");
    next();
  });

  app.use(
    session({
      store: new SessionStore({ uri: settings.database }),
      secret: settings.website.secret,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }, // Set to true if using https
    })
  );

  app.use(
    express.json({
      inflate: true,
      limit: "500kb",
      reviver: null,
      strict: true,
      type: "application/json",
      verify: undefined,
    })
  );

  const listener = app.listen(settings.website.port, async function () {
    /* clear all afk sessions */
    await db.set('afkSessions', {});
    console.log(
      chalk.white("Web cluster is now ") + chalk.green('online')
    );
  });

  var cache = false;
  app.use(function (req, res, next) {
    let manager = loadConfig("./config.toml").api
      .client.ratelimits;
    if (manager[req._parsedUrl.pathname]) {
      if (cache == true) {
        setTimeout(async () => {
          let allqueries = Object.entries(req.query);
          let querystring = "";
          for (let query of allqueries) {
            querystring = querystring + "&" + query[0] + "=" + query[1];
          }
          querystring = "?" + querystring.slice(1);
          res.redirect(
            (req._parsedUrl.pathname.slice(0, 1) == "/"
              ? req._parsedUrl.pathname
              : "/" + req._parsedUrl.pathname) + querystring
          );
        }, 1000);
        return;
      } else {
        cache = true;
        setTimeout(async () => {
          cache = false;
        }, 1000 * manager[req._parsedUrl.pathname]);
      }
    }
    next();
  });

  // Load the API files.
  let apifiles = fs.readdirSync("./modules").filter((file) => file.endsWith(".js"));

  apifiles.forEach((file) => {
    let apifile = require(`./modules/${file}`);
    apifile.load(app, db);
  });

  app.all("*", async (req, res) => {
    if (req.session.pterodactyl)
      if (
        req.session.pterodactyl.id !==
        (await db.get("users-" + req.session.userinfo.id))
      )
        return res.redirect("/login?prompt=none");
    let theme = indexjs.get(req);
    if (settings.api.afk.enabled == true)
      req.session.arcsessiontoken = Math.random().toString(36).substring(2, 15);
    if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname))
      if (!req.session.userinfo || !req.session.pterodactyl)
        return res.redirect(
          "/login" +
            (req._parsedUrl.pathname.slice(0, 1) == "/"
              ? "?redirect=" + req._parsedUrl.pathname.slice(1)
              : "")
        );
    if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
      const renderData = await renderdataeval(req, theme);
      res.render(theme.settings.notfound, renderData);
      return;
    }
    const data = await renderdataeval(req, theme);
    res.render(theme.settings.pages[req._parsedUrl.pathname.slice(1)] || theme.settings.notfound, data);
  });

  module.exports.get = function (req) {
    return {
      settings: fs.existsSync(`./views/pages.json`)
        ? JSON.parse(fs.readFileSync(`./views/pages.json`).toString())
        : defaultthemesettings
    };
  };

  module.exports.islimited = async function () {
    return cache == true ? false : true;
  };

  module.exports.ratelimits = async function (length) {
    if (cache == true) return setTimeout(indexjs.ratelimits, 1);
    cache = true;
    setTimeout(async function () {
      cache = false;
    }, length * 1000);
  };

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
}
