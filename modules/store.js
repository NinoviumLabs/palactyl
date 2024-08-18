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

const indexjs = require("../app.js");
const adminjs = require("./admin.js");
const loadConfig = require("../handlers/config");
const settings = loadConfig("./config.toml");
const fs = require("fs");
const ejs = require("ejs");
const log = require("../handlers/log.js");
const moment = require('moment');

const REWARD_AMOUNT = 150;
const DAY_IN_MILLISECONDS = 86400000;

/* Ensure platform release target is met */
const heliactylModule = { "name": "Resources Store", "target_platform": "10.0.0" };

/* Module */
module.exports.heliactylModule = heliactylModule;
module.exports.load = async function (app, db) {
  app.get("/buy", async (req, res) => {
    if (!req.session.pterodactyl) return res.redirect("/login");

    let settings = await enabledCheck(req, res);
    if (!settings) return;

    const { type, amount } = req.query;
    if (!type || !amount) return res.send("Missing type or amount");

    const validTypes = ["ram", "disk", "cpu", "servers"];
    if (!validTypes.includes(type)) return res.send("Invalid type");

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 1 || parsedAmount > 10)
      return res.send("Amount must be a number between 1 and 10");

    const theme = indexjs.get(req);
    const failedCallbackPath =
      theme.settings.redirect[`failedpurchase${type}`] || "/";

    const userCoins = (await db.get(`coins-${req.session.userinfo.id}`)) || 0;
    const resourceCap =
      (await db.get(`${type}-${req.session.userinfo.id}`)) || 0;

    const { per, cost } = settings.api.client.coins.store[type];
    const purchaseCost = cost * parsedAmount;

    if (userCoins < purchaseCost)
      return res.redirect(`${failedCallbackPath}?err=CANNOTAFFORD`);

    const newUserCoins = userCoins - purchaseCost;
    const newResourceCap = resourceCap + parsedAmount;
    const extraResource = per * parsedAmount;

    if (newUserCoins === 0) {
      await db.delete(`coins-${req.session.userinfo.id}`);
      await db.set(`${type}-${req.session.userinfo.id}`, newResourceCap);
    } else {
      await db.set(`coins-${req.session.userinfo.id}`, newUserCoins);
      await db.set(`${type}-${req.session.userinfo.id}`, newResourceCap);
    }

    let extra = (await db.get(`extra-${req.session.userinfo.id}`)) || {
      ram: 0,
      disk: 0,
      cpu: 0,
      servers: 0,
    };

    extra[type] += extraResource;

    if (Object.values(extra).every((v) => v === 0)) {
      await db.delete(`extra-${req.session.userinfo.id}`);
    } else {
      await db.set(`extra-${req.session.userinfo.id}`, extra);
    }

    adminjs.suspend(req.session.userinfo.id);

    log(
      `Resources Purchased`,
      `${req.session.userinfo.username}#${req.session.userinfo.discriminator} bought ${extraResource} ${type} from the store for \`${purchaseCost}\` coins.`
    );

    res.redirect(
      (theme.settings.redirect[`purchase${type}`]
        ? theme.settings.redirect[`purchase${type}`]
        : "/") + "?err=none"
    );
  });
  
app.post('/claim-reward', async (req, res) => {
  if (!req.session.pterodactyl) {
      return res.status(401).send('Unauthorized');
  }

  const userId = req.session.userinfo.id;
  const lastClaim = await db.get(`last-claim-${userId}`);

  if (lastClaim && new Date() - new Date(lastClaim) < DAY_IN_MILLISECONDS) {
      return res.status(403).send('Reward already claimed today.');
  }

  await db.set(`last-claim-${userId}`, new Date().toISOString());
  let usercoins = await db.get("coins-" + req.session.userinfo.id);
  usercoins = usercoins ? usercoins : 0;
  // Adjust the increment based on the user package
  usercoins = usercoins + settings.api.client.coins.dailyReward
  await db.set("coins-" + req.session.userinfo.id, usercoins);

  res.redirect('../dashboard?err=CLAIMED')
});

app.get('/reward-status', async (req, res) => {
  if (!req.session.pterodactyl) {
      return res.status(401).send('Unauthorized');
  }

  const userId = req.session.userinfo.id;
  const lastClaim = await db.get(`last-claim-${userId}`);

  if (!lastClaim) {
      return res.json({ claimable: true, nextClaimIn: null });
  }

  const timePassed = new Date() - new Date(lastClaim);
  if (timePassed >= DAY_IN_MILLISECONDS) {
      return res.json({ claimable: true, nextClaimIn: null });
  } else {
      const nextClaimIn = DAY_IN_MILLISECONDS - timePassed;
      return res.json({ claimable: false, nextClaimIn });
  }
});

  async function enabledCheck(req, res) {
    if (settings.api.client.coins.store.enabled) return settings;

    const theme = indexjs.get(req);
    ejs.renderFile(
      `./views/${theme.settings.notfound}`,
      await eval(indexjs.renderdataeval),
      null,
      function (err, str) {
        delete req.session.newaccount;
        if (err) {
          console.log(
            `App ― An error has occurred on path ${req._parsedUrl.pathname}:`
          );
          console.log(err);
          return res.send(
            "An error has occurred while attempting to load this page. Please contact an administrator to fix this."
          );
        }
        res.status(200);
        res.send(str);
      }
    );
    return null;
  }
};
