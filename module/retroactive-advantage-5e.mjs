class RetroAdvantage5e {
  static MODULE_NAME = "retroactive-advantage-5e";
  static MODULE_TITLE = "Retroactive Advantage DnD5e";

  /**
   * Handles creating a new D20Roll instance with the updated roll method and totals based on a given one
   * @param {D20Roll} d20Roll               The original instance.
   * @param {AdvantageMode} newAdvMode      CONFIG.Dice.D20Roll.ADV_MODE.
   * @param {object} [messageOptions]       Options passed to Dice So Nice for the new roll if necessary.
   * @returns {D20Roll}                     A new D20Roll instance with the updated details.
   */
  static async _makeNewRoll(d20Roll, newAdvMode, messageOptions) {
    if (newAdvMode === undefined) {
      throw new Error('you must provide what the New Advantage mode is')
    }

    if (!(d20Roll instanceof CONFIG.Dice.D20Roll)) {
      throw new Error('provided roll was not an instance of D20Roll');
    }

    if (d20Roll.options.advantageMode === newAdvMode) {
      throw new Error('provided roll is already that kind of roll');
    }

    if (d20Roll.terms[0]?.faces !== 20) {
      throw new Error("provided roll does not look like a typical d20 roll");
    }

    const {DISADVANTAGE, NORMAL, ADVANTAGE} = CONFIG.Dice.D20Roll.ADV_MODE;

    // DIY Roll.clone because we want to be able to change things without mutating the original
    // Core's clone method preserves the references to the options and data objects
    let newD20Roll = new d20Roll.constructor(d20Roll._formula, {...d20Roll.data}, {...d20Roll.options});

    newD20Roll.options.advantageMode = newAdvMode;

    // mutate new terms to look like old ones
    newD20Roll.terms = [...d20Roll.terms];

    let d20Term = newD20Roll.terms[0];
    // original roll mods without the kh or kl modifiers
    const filteredModifiers = d20Term.modifiers.filter((modifier) => !['kh', 'kl'].includes(modifier));
    const originalResultsLength = d20Term.results.length;
    // reset roll to not have the kh or kl modifiers
    d20Term.modifiers = [...filteredModifiers];

    // do stuff to the terms and modifiers
    switch (newAdvMode) {
      case (NORMAL): {
        d20Term.number = 1;
        d20Term.results = [d20Term.results.shift()]; // keep only the result of the first element of the array
        break;
      }

      case (ADVANTAGE): {
        d20Term.modifiers.push('kh');

        // if this d20Term doesn't already have more than 1 rolled value, add a new one
        if (d20Term.number === 1) {
          d20Term.number = 2;
          await d20Term.roll();
        }
        break;
      }

      case (DISADVANTAGE): {
        d20Term.modifiers.push('kl');

        // if this d20Term doesn't already have more than 1 rolled value, add a new one
        if (d20Term.number === 1) {
          d20Term.number = 2;
          await d20Term.roll();
        }
        break;
      }
    }

    // clear out term flavor to prevent "Reliable Talent" loop
    d20Term.options.flavor = undefined;

    // mutate each term to reset to pre-evaluateModifiers state
    d20Term.results.forEach((term) => {
      term.active = true; // all terms start as active
      delete term.discarded; // no terms start as discarded
      delete term.indexThrow; // wtf is indexThrow
    });

    // handle new terms based on the roll modifiers
    await d20Term._evaluateModifiers();

    // reconstruct the formula after adjusting the terms
    newD20Roll._formula = newD20Roll.constructor.getFormula(newD20Roll.terms);

    // re-evaluate total after adjusting the terms
    newD20Roll._total = newD20Roll._evaluateTotal();

    // After evaluating modifiers again, Create a Fake Roll result and roll for dice so nice to roll the new dice.
    // We have to do this after modifiers because of stuff like halfling luck which might spawn more dice.
    if (game.modules.get('dice-so-nice')?.active && d20Term.results.length > originalResultsLength) {
      const fakeD20Roll = Roll.fromTerms([new Die({...d20Term})]);

      // we are being extra and only rolling the new dice
      fakeD20Roll.terms[0].results = fakeD20Roll.terms[0].results.filter((foo, index) => index > 0);
      fakeD20Roll.terms[0].number = fakeD20Roll.terms[0].results.length;

      await game.dice3d.showForRoll(
        fakeD20Roll,
        game.users.get(messageOptions?.userId),
        true,
        messageOptions?.whisper?.length ? messageOptions.whisper : null,
        messageOptions?.blind,
        null,
        messageOptions?.speaker
      );
    }

    return newD20Roll;
  }

  /**
   * Handles our button clicks from the chat log
   * @param {string} action
   * @param {string} messageId
   */
  static _handleChatButton = async (action, messageId) => {
    try {
      const {DISADVANTAGE, NORMAL, ADVANTAGE} = CONFIG.Dice.D20Roll.ADV_MODE;
      const chatMessage = game.messages.get(messageId);

      if (!action || !chatMessage) throw new Error('Missing Information');

      const [roll] = chatMessage.rolls;

      if (!(roll instanceof CONFIG.Dice.D20Roll)) return;

      let newD20Roll;

      const messageOptions = {
        userId: chatMessage.user,
        whisper: chatMessage.whisper,
        blind: chatMessage.blind,
        speaker: chatMessage.speaker
      };

      switch (action) {
        case 'dis': {
          newD20Roll = await this._makeNewRoll(roll, DISADVANTAGE, messageOptions);
          break;
        }
        case 'norm': {
          newD20Roll = await this._makeNewRoll(roll, NORMAL, messageOptions);
          break;
        }
        case 'adv': {
          newD20Roll = await this._makeNewRoll(roll, ADVANTAGE, messageOptions);
          break;
        }
      }

      let update = await newD20Roll.toMessage({}, {create: false});
      [
        "blind", "timestamp", "user", "whisper", "speaker",
        "emote", "flags", "sound", "type", "_id"
      ].forEach(k => delete update[k]);
      update = foundry.utils.mergeObject(chatMessage.toJSON(), update);

      return chatMessage.update(update);
    } catch (err) {
      console.error('A problem occurred with Retroactive Advantage 5e:', err);
    }
  }

  /** Initialize module. */
  static init() {
    console.log(`${RetroAdvantage5e.MODULE_NAME} | Initializing ${RetroAdvantage5e.MODULE_TITLE}`);

    /**
     * Add buttons and set up listeners.
     * @param {ChatMessage5e} message     The message being rendered.
     * @param {HTMLElement} html          The element of the message.
     */
    Hooks.on("dnd5e.renderChatMessage", async (message, html) => {
      if (!(message.isAuthor || message.isOwner) || !message.isRoll) return;
      const [roll] = message.rolls;
      if (!(roll instanceof CONFIG.Dice.D20Roll)) return;
      const advantageMode = roll?.options?.advantageMode;

      const div = document.createElement("DIV");
      div.innerHTML = await renderTemplate("modules/retroactive-advantage-5e/module/retro-buttons.hbs", {
        dis: advantageMode === CONFIG.Dice.D20Roll.ADV_MODE.DISADVANTAGE,
        norm: advantageMode === CONFIG.Dice.D20Roll.ADV_MODE.NORMAL,
        adv: advantageMode === CONFIG.Dice.D20Roll.ADV_MODE.ADVANTAGE
      });

      div.querySelectorAll("[data-retro-action]").forEach(n => {
        n.addEventListener("click", RetroAdvantage5e._onClickRetroButton.bind(RetroAdvantage5e));
      });

      const cc = html.querySelector(".dnd5e2.chat-card");
      if (cc) return cc.append(div.firstElementChild);

      const dr = html.querySelector(".dice-roll");
      if (dr) return dr.before(div.firstElementChild);
    });
  }

  /**
   * Handle clicking a retro button.
   * @param {PointerEvent} event      The initiating click event.
   */
  static async _onClickRetroButton(event) {
    const action = event.currentTarget.dataset.retroAction;
    const messageId = event.currentTarget.closest('[data-message-id]').dataset.messageId;
    this._handleChatButton(action, messageId);
  }
}

Hooks.on("init", RetroAdvantage5e.init);
