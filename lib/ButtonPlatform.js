// homebridge-button-platform/lib/ButtonPlatform.js
// Copyright (c) 2020 Avi Miller.
//
// Homebridge platform plugin to create virtual StatelessProgrammableSwitch buttons

'use strict';

const express = require('express');
const { check, validationResult } = require('express-validator');
const events = require('events');
const HomebridgeLib = require('homebridge-lib');
const ButtonAccessory = require('./ButtonAccessory');

class ButtonPlatform extends HomebridgeLib.Platform {
  constructor (log, configJson, homebridge) {
    super(log, configJson, homebridge);
    if (configJson == null) {
      return;
    }
    this.on('accessoryRestored', this.accessoryRestored);
    this.once('heartbeat', this.init);

    this.config = {
      name: 'Buttons',
      port: 3001,
      buttons: []
    };

    const optionParser = new HomebridgeLib.OptionParser(this.config, true);
    optionParser.stringKey('name');
    optionParser.intKey('port', 1025, 65535);
    optionParser.listKey('buttons');
    optionParser.on('usageError', (message) => {
      this.warn('Configuration issue: %s', message);
    });

    try {
      optionParser.parse(configJson);
      if (this.config.buttons.length === 0) {
        this.warn('Configuration issue: no buttons configured.');
      }

      this.app = express();
      this.app.listen(this.config.port, () => this.log('Listening on port %s for inbound button push event notifications', this.config.port));
      this.app.use(express.json());
      this.app.use(express.urlencoded({ extended: false }));

      this.buttonAccessories = {};
    } catch (error) {
      this.fatal(error);
    }
  }

  async init (beat) {
    const jobs = [];
    for (const button of this.config.buttons) {
      if (this.buttonAccessories[button] == null) {
        const buttonAccessory = new ButtonAccessory(this, { button: button });
        jobs.push(events.once(buttonAccessory, 'initialised'));
        this.setupRoute(buttonAccessory);
        this.buttonAccessories[button] = buttonAccessory;
      } else {
        this.buttonAccessories[button].setAlive();
      }
    }
    for (const job of jobs) {
      await job;
    }

    // Express handler for invalid paths
    this.app.use(function (req, res) {
      res.status(404).send('Button not found.');
      this.warn('Received event for unconfigured Button path: %s', req.originalUrl);
    }.bind(this));

    // Express handler for server-side errors
    this.app.use(function (err, req, res) {
      res.status(500).send('Server error.');
      this.fatal(err.stack);
    }.bind(this));

    this.debug('initialised');
    this.emit('initialised');
  }

  accessoryRestored (className, version, id, name, context) {
    if (className !== 'ButtonAccessory') {
      this.warn(
        'removing cached %s accessory %s',
        className, context.button
      );
      return;
    }
    const buttonAccessory = new ButtonAccessory(this, context);
    this.setupRoute(buttonAccessory);
    this.buttonAccessories[context.button] = buttonAccessory;
  }

  setupRoute (accessory) {
    const uri = '/button-' + accessory.name.toLowerCase().replace(/[^a-z0-9]/gi, '-');
    this.log('The Event URI for %s is: %s', accessory.name, uri);

    this.app.post(uri, [
      check('event').isIn(['click', 'double-click', 'hold', 'single-press', 'double-press', 'long-press'])
    ], (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ errors: errors.array() });
      } else {
        var event = req.body.event;
        res.status(200).send('Success.');
        this.log('Received POST request on %s to trigger a [%s] event for %s', uri, event, accessory.name);
        switch (event) {
          case 'click':
          case 'single-press':
            accessory.buttonServices.statelessProgrammableSwitch.triggerEvent(0);
            break;
          case 'double-click':
          case 'double-press':
            accessory.buttonServices.statelessProgrammableSwitch.triggerEvent(1);
            break;
          case 'hold':
          case 'long-press':
            accessory.buttonServices.statelessProgrammableSwitch.triggerEvent(2);
            break;
        }
      }
    });
  }
}

module.exports = ButtonPlatform;
