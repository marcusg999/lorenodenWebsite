#!/usr/bin/env node
'use strict';
/* Create the portal account, or change its password.
     npm run set-password -- <username> <password>
   With no arguments it reads ADMIN_USER / ADMIN_PASSWORD from the environment. */
const { createUser, setPassword, findUser, userCount } = require('./auth');

const [username = process.env.ADMIN_USER, password = process.env.ADMIN_PASSWORD] = process.argv.slice(2);

if (!username || !password) {
  console.error(`
Usage:  npm run set-password -- <username> <password>
   or:  ADMIN_USER=loren ADMIN_PASSWORD='…' npm run set-password

The password must be at least 12 characters.
Generate a strong one with:  openssl rand -base64 18
`);
  process.exit(1);
}

try {
  if (findUser(username)) {
    setPassword(username, password);
    console.log(`✓ Password updated for "${username}".`);
  } else {
    createUser(username, password);
    console.log(`✓ Created portal account "${username}".`);
  }
  console.log(`  ${userCount()} account(s) exist. Sign in at /admin/login`);
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}
