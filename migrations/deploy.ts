const anchor = require("@coral-xyz/anchor");

module.exports = async function deploy(provider: typeof anchor.AnchorProvider) {
  anchor.setProvider(provider);
};
