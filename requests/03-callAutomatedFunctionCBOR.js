// original source: https://github.com/smartcontractkit/smart-contract-examples/blob/main/functions-examples/examples/10-automate-functions/updateRequest.js
const fs = require("fs");
const path = require("path");
var toml = require('toml');
const config = toml.parse(fs.readFileSync('./config.toml', 'utf-8'));

const ethers = require("ethers");

const {
    SecretsManager,
    simulateScript,
    buildRequestCBOR,
    ReturnType,
    decodeResult,
    Location,
    CodeLanguage,
} = require("@chainlink/functions-toolkit");

require("@chainlink/env-enc").config();

const automatedFunctionsConsumerAbi = require(config.CONTRACT_ABI);
const consumerAddress = config.CONSUMER_ADDRESS;
const subscriptionId = config.SUBSCRIPTION_ID;

const updateRequestMumbai = async () => {
    const routerAddress = config.ROUTER_ADDRESS;
    const donId = config.DONID;
    const gatewayUrls = [
        config.GATEWAY_URL1,
        config.GATEWAY_URL2,
    ];
    const explorerUrl = config.EXPLORER_URL;

    // Initialize functions settings
    const sourceFile = config.SOURCEFILE;
    const source = fs
        .readFileSync(path.resolve(__dirname, sourceFile))
        .toString();

    const args = config.ARGS;
    const secrets = { apiKey: process.env.COINMARKETCAP_API_KEY };
    const slotIdNumber = config.SLOT_ID_NUMBER; // slot ID where to upload the secrets
    const expirationTimeMinutes = config.EXPIRATION_TIME_MINUTES; // expiration time in minutes of the secrets
    const gasLimit = config.GAS_LIMIT;

    // Initialize ethers signer and provider to interact with the contracts onchain
    const privateKey = process.env.DEVELOPER_ACCOUNT_PK; // fetch PRIVATE_KEY
    if (!privateKey)
        throw new Error(
            "private key not provided - check your environment variables"
        );

    const rpcUrl = process.env.POLYGON_MUMBAI_RPC_URL; // fetch mumbai RPC URL

    if (!rpcUrl)
        throw new Error(`rpcUrl not provided  - check your environment variables`);

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    const wallet = new ethers.Wallet(privateKey);
    const signer = wallet.connect(provider); // create ethers signer for signing transactions

    ///////// START SIMULATION ////////////

    console.log("Start simulation...");

    const response = await simulateScript({
        source: source,
        args: args,
        bytesArgs: [], // bytesArgs - arguments can be encoded off-chain to bytes.
        secrets: secrets,
    });

    console.log("Simulation result", response);
    const errorString = response.errorString;
    if (errorString) {
        console.log(`❌ Error during simulation: `, errorString);
    } else {
        const returnType = ReturnType.uint256;
        const responseBytesHexstring = response.responseBytesHexstring;
        if (ethers.utils.arrayify(responseBytesHexstring).length > 0) {
            const decodedResponse = decodeResult(
                response.responseBytesHexstring,
                returnType
            );
            console.log(`✅ Decoded response to ${returnType}: `, decodedResponse);
        }
    }

    //////// MAKE REQUEST ////////

    console.log("\nMake request...");

    // First encrypt secrets and upload the encrypted secrets to the DON
    const secretsManager = new SecretsManager({
        signer: signer,
        functionsRouterAddress: routerAddress,
        donId: donId,
    });
    await secretsManager.initialize();

    // Encrypt secrets and upload to DON
    const encryptedSecretsObj = await secretsManager.encryptSecrets(
        secrets
    );

    console.log(
        `Upload encrypted secret to gateways ${gatewayUrls}. slotId ${slotIdNumber}. Expiration in minutes: ${expirationTimeMinutes}`
    );
    // Upload secrets
    const uploadResult = await secretsManager.uploadEncryptedSecretsToDON({
        encryptedSecretsHexstring: encryptedSecretsObj.encryptedSecrets,
        gatewayUrls: gatewayUrls,
        slotId: slotIdNumber,
        minutesUntilExpiration: expirationTimeMinutes,
    });

    if (!uploadResult.success)
        throw new Error(`Encrypted secrets not uploaded to ${gatewayUrls}`);

    console.log(
        `\n✅ Secrets uploaded properly to gateways ${gatewayUrls}! Gateways response: `,
        uploadResult
    );

    const donHostedSecretsVersion = parseInt(uploadResult.version); // fetch the version of the encrypted secrets
    const donHostedEncryptedSecretsReference =
        secretsManager.buildDONHostedEncryptedSecretsReference({
            slotId: slotIdNumber,
            version: donHostedSecretsVersion,
        }); // encode encrypted secrets version

    const automatedFunctionsConsumer = new ethers.Contract(
        consumerAddress,
        automatedFunctionsConsumerAbi.abi,
        signer
    );

    // Encode request

    const functionsRequestBytesHexString = buildRequestCBOR({
        codeLocation: Location.Inline, // Location of the source code - Only Inline is supported at the moment
        codeLanguage: CodeLanguage.JavaScript, // Code language - Only JavaScript is supported at the moment
        secretsLocation: Location.DONHosted, // Location of the encrypted secrets - DONHosted in this example
        source: source, // soure code
        encryptedSecretsReference: donHostedEncryptedSecretsReference,
        args: args,
        bytesArgs: [], // bytesArgs - arguments can be encoded off-chain to bytes.
    });

    // Update request settings
    const transaction = await automatedFunctionsConsumer.updateRequest(
        functionsRequestBytesHexString,
        subscriptionId,
        gasLimit,
        ethers.utils.formatBytes32String(donId) // jobId is bytes32 representation of donId
    );

    // Log transaction details
    console.log(
        `\n✅ Automated Functions request settings updated! Transaction hash ${transaction.hash} - Check the explorer ${explorerUrl}/tx/${transaction.hash}`
    );
};

updateRequestMumbai().catch((e) => {
    console.error(e);
    process.exit(1);
});