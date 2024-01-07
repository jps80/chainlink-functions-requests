
// original source: https://github.com/smartcontractkit/smart-contract-examples/blob/main/functions-examples/examples/8-multiple-apis/source.js
const fs = require("fs");
const path = require("path");
var toml = require('toml');
const config = toml.parse(fs.readFileSync('./config.toml', 'utf-8'));

const ethers = require("ethers");

const {
    SubscriptionManager,
    SecretsManager,
    simulateScript,
    ResponseListener,
    ReturnType,
    decodeResult,
    FulfillmentCode,
} = require("@chainlink/functions-toolkit");

require("@chainlink/env-enc").config();

const functionsConsumerAbi = require(config.CONTRACT_ABI);
const consumerAddress = config.CONSUMER_ADDRESS;
const subscriptionId = config.SUBSCRIPTION_ID;

const makeRequestMumbai = async () => {
    const routerAddress = config.ROUTER_ADDRESS;
    const linkTokenAddress = config.LINK_TOKEN_ADDRESS;
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
    const privateKey = process.env.DEVELOPER_ACCOUNT_PK; // fetch DEVELOPER_ACCOUNT_PK
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

    //////// ESTIMATE REQUEST COSTS ////////
    console.log("\nEstimate request costs...");
    // Initialize and return SubscriptionManager
    const subscriptionManager = new SubscriptionManager({
        signer: signer,
        linkTokenAddress: linkTokenAddress,
        functionsRouterAddress: routerAddress,
    });
    await subscriptionManager.initialize();

    // estimate costs in Juels

    const gasPriceWei = await signer.getGasPrice(); // get gasPrice in wei

    const estimatedCostInJuels =
        await subscriptionManager.estimateFunctionsRequestCost({
            donId: donId, // ID of the DON to which the Functions request will be sent
            subscriptionId: subscriptionId, // Subscription ID
            callbackGasLimit: gasLimit, // Total gas used by the consumer contract's callback
            gasPriceWei: BigInt(gasPriceWei), // Gas price in gWei
        });

    console.log(
        `Fulfillment cost estimated to ${ethers.utils.formatEther(
            estimatedCostInJuels
        )} LINK`
    );

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

    const donHostedSecretsVersion = parseInt(uploadResult.version); // fetch the reference of the encrypted secrets

    const functionsConsumer = new ethers.Contract(
        consumerAddress,
        functionsConsumerAbi.abi,
        signer
    );

    // Actual transaction call
    const transaction = await functionsConsumer.sendRequest(
        source, // source
        "0x", // user hosted secrets - encryptedSecretsUrls - empty in this example
        slotIdNumber, // slot ID of the encrypted secrets
        donHostedSecretsVersion, // version of the encrypted secrets
        args,
        [], // bytesArgs - arguments can be encoded off-chain to bytes.
        subscriptionId,
        gasLimit,
        ethers.utils.formatBytes32String(donId) // jobId is bytes32 representation of donId
    );

    // Log transaction details
    console.log(
        `\n✅ Functions request sent! Transaction hash ${transaction.hash}. Waiting for a response...`
    );

    console.log(
        `See your request in the explorer ${explorerUrl}/tx/${transaction.hash}`
    );

    const responseListener = new ResponseListener({
        provider: provider,
        functionsRouterAddress: routerAddress,
    }); // Instantiate a ResponseListener object to wait for fulfillment.
    (async () => {
        try {
            const response = await new Promise((resolve, reject) => {
                responseListener
                    .listenForResponseFromTransaction(transaction.hash)
                    .then((response) => {
                        resolve(response); // Resolves once the request has been fulfilled.
                    })
                    .catch((error) => {
                        reject(error); // Indicate that an error occurred while waiting for fulfillment.
                    });
            });

            const fulfillmentCode = response.fulfillmentCode;

            if (fulfillmentCode === FulfillmentCode.FULFILLED) {
                console.log(
                    `\n✅ Request ${response.requestId
                    } successfully fulfilled. Cost is ${ethers.utils.formatEther(
                        response.totalCostInJuels
                    )} LINK.Complete reponse: `,
                    response
                );
            } else if (fulfillmentCode === FulfillmentCode.USER_CALLBACK_ERROR) {
                console.log(
                    `\n⚠️ Request ${response.requestId
                    } fulfilled. However, the consumer contract callback failed. Cost is ${ethers.utils.formatEther(
                        response.totalCostInJuels
                    )} LINK.Complete reponse: `,
                    response
                );
            } else {
                console.log(
                    `\n❌ Request ${response.requestId
                    } not fulfilled. Code: ${fulfillmentCode}. Cost is ${ethers.utils.formatEther(
                        response.totalCostInJuels
                    )} LINK.Complete reponse: `,
                    response
                );
            }

            const errorString = response.errorString;
            if (errorString) {
                console.log(`\n❌ Error during the execution: `, errorString);
            } else {
                const responseBytesHexstring = response.responseBytesHexstring;
                if (ethers.utils.arrayify(responseBytesHexstring).length > 0) {
                    const decodedResponse = decodeResult(
                        response.responseBytesHexstring,
                        setDynamicReturnType(config.RETURN_TYPE)
                    );
                    console.log(
                        `\n✅ Decoded response to ${setDynamicReturnType(config.RETURN_TYPE)}: `,
                        decodedResponse
                    );
                }
            }
        } catch (error) {
            console.error("Error listening for response:", error);
        }
    })();
};

// Función para establecer dinámicamente el tipo de retorno
function setDynamicReturnType(returnTypeValue) {
    let returnType;

    // Verificar el valor del archivo de configuración y asignar el tipo de retorno correspondiente
    switch (returnTypeValue) {
        case 'uint':
            returnType = ReturnType.uint;
            break;
        case 'uint256':
            returnType = ReturnType.uint256;
            break;
        case 'int':
            returnType = ReturnType.int;
            break;
        case 'int256':
            returnType = ReturnType.int256;
            break;
        case 'string':
            returnType = ReturnType.string;
            break;
        case 'bytes':
            returnType = ReturnType.bytes;
            break;
        default:
            returnType = ReturnType.string; // Tipo de retorno predeterminado en caso de valor no válido
            break;
    }

    return returnType;
}

makeRequestMumbai().catch((e) => {
    console.error(e);
    process.exit(1);
});