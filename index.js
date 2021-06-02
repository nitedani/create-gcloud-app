#!/usr/bin/env node
const prompts = require("prompts");
const { exec } = require("promisify-child-process");
const degit = require("degit");
const { randomBytes } = require("crypto");
const { writeFileSync } = require("fs");
const makeEnv = (env) =>
  Object.entries(env).reduce(
    (acc, [key, value]) => acc + `${key}=${value}\n`,
    ""
  );
const regionMapping = {
  "europe-west3": "ey",
};
(async () => {
  await exec("gcloud auth login");
  const { stdout: email } = await exec(
    'gcloud config list account --format "value(core.account)"'
  );
  const response = await prompts({
    type: "text",
    name: "value",
    message: "Project name:",
    validate: (value) => (value.length < 6 ? `At least 6 characters` : true),
  });

  const projectName = `cga-${response.value}`;
  await exec(`gcloud projects create ${projectName} --set-as-default`);

  const { stdout: std_regions } = await exec("gcloud app regions list");
  const split0 = std_regions.split("\n");
  split0.splice(0, 1);
  split0.splice(split0.length - 1, 1);
  const regions = split0.map((row) => row.substring(0, row.indexOf(" ")));
  const { selectedRegion } = await prompts({
    message: "Select a region for your app deployment",
    type: "select",
    name: "selectedRegion",
    choices: regions,
  });
  await exec(`gcloud app create --region=${regions[selectedRegion]}`);
  const regionAbb = regionMapping[regions[selectedRegion]];

  const jwtSecret = randomBytes(256).toString("base64");

  await prompts({
    type: "confirm",
    name: "value",
    message: `Please configure Google billing: https://console.cloud.google.com/billing/linkedaccount?project=${projectName}`,
    initial: true,
  });

  await exec("gcloud services enable cloudbuild.googleapis.com");

  await prompts({
    type: "confirm",
    name: "value",
    message: `Please configure Google auth consent: https://console.cloud.google.com/apis/credentials/consent/edit;newAppInternalUser=false?project=${projectName}\nAuthorized domains: ${projectName}.${regionAbb}.r.appspot.com\nScopes: [email, profile]\nUsers: ${email}`,
    initial: true,
  });

  console.log("Please configure Google auth");
  console.log(
    `https://console.cloud.google.com/apis/credentials/oauthclient?project=${projectName}`
  );
  console.log("");
  console.log("Add these authorized origins:");
  console.log("http://localhost:3000");
  console.log(`https://${projectName}.${regionAbb}.r.appspot.com`);
  console.log("");
  console.log("Add these redirect URIs:");
  console.log("http://localhost:3000/auth/google/redirect");
  console.log(
    `https://${projectName}.${regionAbb}.r.appspot.com/auth/google/redirect`
  );

  const { clientId } = await prompts({
    type: "text",
    name: "clientId",
    message: "Client id:",
    validate: (value) => (value.length < 6 ? false : true),
  });

  const { clientSecret } = await prompts({
    type: "text",
    name: "clientSecret",
    message: "Client secret:",
    validate: (value) => (value.length < 6 ? false : true),
  });

  const dev = {
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: "10d",
    OAUTH_GOOGLE_ID: clientId,
    OAUTH_GOOGLE_SECRET: clientSecret,
    OAUTH_GOOGLE_REDIRECT_URL: "http://localhost:3000/auth/google/redirect",
    GCP_SA_KEYFILE: "sa-private-key.json",
    MAIL_FROM: null,
  };

  const prod = {
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: "10d",
    OAUTH_GOOGLE_ID: clientId,
    OAUTH_GOOGLE_SECRET: clientSecret,
    OAUTH_GOOGLE_REDIRECT_URL: `https://${projectName}.${regionAbb}.r.appspot.com/auth/google/redirect`,
    MAIL_FROM: null,
  };

  const emitter = degit("git@github.com:nitedani/nestjs-next.js-starter", {
    cache: false,
    force: false,
    verbose: true,
  });

  console.log("Scaffolding project...");
  await emitter.clone(projectName);

  await exec(
    `gcloud iam service-accounts keys create ${projectName}/sa-private-key.json --iam-account=${projectName}@appspot.gserviceaccount.com`
  );

  writeFileSync(`${projectName}/.env`, makeEnv(dev));
  writeFileSync(`${projectName}/.env.production`, makeEnv(prod));
  await exec(`git init ${projectName}`);
  await exec(`git -C ${projectName}/ add .`);
  await exec(`git -C ${projectName}/ commit -m"initial"`);
  console.log("Installing dependencies...");
  await exec(`cd ${projectName} && npm install --force --silent`);
})();
