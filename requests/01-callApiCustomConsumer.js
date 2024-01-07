const fs = require("fs");
const path = require("path");
var toml = require('toml');
const config = toml.parse(fs.readFileSync('./config.toml', 'utf-8'));

const ethers = require("ethers");

const {
  SubscriptionManager,
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
  const explorerUrl = config.EXPLORER_URL;

  // Initialize functions settings
  const sourceFile = config.SOURCEFILE;
  const source = fs
    .readFileSync(path.resolve(__dirname, sourceFile))
    .toString();

  const args = config.ARGS;
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
    secrets: {}, // no secrets in this example
  });

  console.log("Simulation result", response);
  const errorString = response.errorString;
  if (errorString) {
    console.log(`❌ Error during simulation: `, errorString);
  } else {
    const returnType = ReturnType.string;
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

  const functionsConsumer = new ethers.Contract(
    consumerAddress,
    functionsConsumerAbi.abi,
    signer
  );

  // Actual transaction call
  const transaction = await functionsConsumer.sendRequest(
    source,
    subscriptionId,
    args,
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