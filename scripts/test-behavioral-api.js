"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var ethers_1 = require("ethers");
var axios_1 = __importDefault(require("axios"));
var pg_1 = require("pg");
var behavioral_utils_1 = require("../src/utils/behavioral.utils");
var behavioralTestSuite_1 = require("../src/tests/behavioralTestSuite");
var dotenv = __importStar(require("dotenv"));
var path = __importStar(require("path"));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
var API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
var API_KEY = process.env.API_KEY || 'sk_test_123'; // Default for testing if not in .env
// Axios instance with auth
var api = axios_1.default.create({
    baseURL: API_BASE_URL,
    headers: {
        'Authorization': "Bearer ".concat(API_KEY),
        'Content-Type': 'application/json'
    }
});
function runTest() {
    return __awaiter(this, void 0, void 0, function () {
        var mockAgentWallet, fingerprintHash, baselineResponses, traitResult, db, mockAgentId, err_1, seedRes, err_2, verifyRes, err_3, semanticResponses, semanticTraitResult, semanticRes, err_4, homographResponses, homographTraitResult, homographRes, err_5;
        var _a, _b, _c, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    console.log('🧪 Starting Phase 1.5 Web2.5 Gateway Integration Test');
                    console.log("Connecting to API at: ".concat(API_BASE_URL));
                    mockAgentWallet = ethers_1.ethers.Wallet.createRandom();
                    fingerprintHash = ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(mockAgentWallet.address + Date.now().toString()));
                    console.log("\n\uD83D\uDD11 Generated mock Agent fingerprintHash: ".concat(fingerprintHash));
                    // 2. Generate a baseline ResponseSet
                    console.log('\n📝 Generating Baseline ResponseSet...');
                    baselineResponses = {
                        testSuiteVersion: behavioralTestSuite_1.REASONING_TEST_SUITE_V1.version,
                        responses: behavioralTestSuite_1.REASONING_TEST_SUITE_V1.prompts.map(function (prompt) { return ({
                            promptId: prompt.id,
                            prompt: prompt.prompt,
                            response: "This is a baseline response to: ".concat(prompt.prompt),
                            timestamp: Date.now()
                        }); }),
                        generatedAt: Date.now()
                    };
                    traitResult = (0, behavioral_utils_1.generateBehavioralTraitHash)(baselineResponses);
                    console.log("Calculated Baseline Trait Hash: ".concat(traitResult.hash));
                    // 3. Inject Agent into Database to pass 404 check
                    console.log('\n🗄️ Step 1: Injecting mock Agent into Database...');
                    db = new pg_1.Client({
                        connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fingerprint'
                    });
                    return [4 /*yield*/, db.connect()];
                case 1:
                    _e.sent();
                    _e.label = 2;
                case 2:
                    _e.trys.push([2, 4, , 6]);
                    mockAgentId = Date.now().toString();
                    return [4 /*yield*/, db.query("\n      INSERT INTO agents (\n        agent_id, fingerprint_hash, name, provider, version, \n        registered_by, created_at, is_revoked, latest_trait_hash\n      )\n      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)\n      ON CONFLICT (fingerprint_hash) DO NOTHING\n    ", [
                            mockAgentId, fingerprintHash, 'Test Agent', 'Test Provider', '1.0.0',
                            '0x1234567890123456789012345678901234567890', new Date(), false, traitResult.hash
                        ])];
                case 3:
                    _e.sent();
                    console.log('✅ Mock Agent injected successfully.');
                    return [3 /*break*/, 6];
                case 4:
                    err_1 = _e.sent();
                    console.error('❌ Failed to inject mock Agent:', err_1.message);
                    return [4 /*yield*/, db.end()];
                case 5:
                    _e.sent();
                    return [2 /*return*/];
                case 6:
                    // 4. Test Seeding the Sidecar (POST /v1/internal/traits/seed)
                    console.log('\n🌱 Step 2: Seeding baseline to Redis Sidecar...');
                    _e.label = 7;
                case 7:
                    _e.trys.push([7, 9, , 10]);
                    return [4 /*yield*/, api.post('/v1/internal/traits/seed', {
                            fingerprintHash: fingerprintHash,
                            responseSet: traitResult.responseSet
                        })];
                case 8:
                    seedRes = _e.sent();
                    console.log('✅ Seed successful:', seedRes.data);
                    return [3 /*break*/, 10];
                case 9:
                    err_2 = _e.sent();
                    console.error('❌ Seeding failed:', ((_a = err_2.response) === null || _a === void 0 ? void 0 : _a.data) || err_2.message);
                    return [2 /*return*/];
                case 10:
                    // 4. Test Verification - Exact Match
                    console.log('\n🔍 Step 2: Testing Verification with Exact Match...');
                    _e.label = 11;
                case 11:
                    _e.trys.push([11, 13, , 14]);
                    return [4 /*yield*/, api.post('/v1/agents/verify', {
                            fingerprintHash: fingerprintHash,
                            currentResponseSet: traitResult.responseSet,
                            context: {
                                ip_address: '127.0.0.1'
                            }
                        })];
                case 12:
                    verifyRes = _e.sent();
                    console.log('✅ Exact Match Result:', {
                        decision: verifyRes.data.decision,
                        trust_score: verifyRes.data.trust_score,
                        signals: verifyRes.data.signals
                    });
                    return [3 /*break*/, 14];
                case 13:
                    err_3 = _e.sent();
                    console.error('❌ Verification failed:', ((_b = err_3.response) === null || _b === void 0 ? void 0 : _b.data) || err_3.message);
                    return [3 /*break*/, 14];
                case 14:
                    // 5. Test Verification - Semantic Variation (Should pass with high trust)
                    console.log('\n🤖 Step 3: Testing Verification with Semantic Variation...');
                    semanticResponses = {
                        testSuiteVersion: behavioralTestSuite_1.REASONING_TEST_SUITE_V1.version,
                        responses: baselineResponses.responses.map(function (r) { return ({
                            promptId: r.promptId,
                            prompt: r.prompt,
                            // Add some extra words but keep meaning similar
                            response: r.response + ' I am highly confident in this answer.',
                            timestamp: Date.now()
                        }); }),
                        generatedAt: Date.now()
                    };
                    semanticTraitResult = (0, behavioral_utils_1.generateBehavioralTraitHash)(semanticResponses);
                    _e.label = 15;
                case 15:
                    _e.trys.push([15, 17, , 18]);
                    return [4 /*yield*/, api.post('/v1/agents/verify', {
                            fingerprintHash: fingerprintHash,
                            currentResponseSet: semanticTraitResult.responseSet,
                            context: {
                                ip_address: '127.0.0.1'
                            }
                        })];
                case 16:
                    semanticRes = _e.sent();
                    console.log('✅ Semantic Variation Result:', {
                        decision: semanticRes.data.decision,
                        trust_score: semanticRes.data.trust_score,
                        signals: semanticRes.data.signals
                    });
                    return [3 /*break*/, 18];
                case 17:
                    err_4 = _e.sent();
                    console.error('❌ Verification failed:', ((_c = err_4.response) === null || _c === void 0 ? void 0 : _c.data) || err_4.message);
                    return [3 /*break*/, 18];
                case 18:
                    // 6. Test Verification - Homograph Attack (Should fail and flag)
                    console.log('\n🚨 Step 4: Testing Verification with Homograph Evasion Attempt...');
                    homographResponses = {
                        testSuiteVersion: behavioralTestSuite_1.REASONING_TEST_SUITE_V1.version,
                        responses: baselineResponses.responses.map(function (r) { return ({
                            promptId: r.promptId,
                            prompt: r.prompt,
                            // Replace 'a' with Cyrillic 'а'
                            response: r.response.replace(/a/g, '\u0430'),
                            timestamp: Date.now()
                        }); }),
                        generatedAt: Date.now()
                    };
                    homographTraitResult = (0, behavioral_utils_1.generateBehavioralTraitHash)(homographResponses);
                    _e.label = 19;
                case 19:
                    _e.trys.push([19, 21, , 22]);
                    return [4 /*yield*/, api.post('/v1/agents/verify', {
                            fingerprintHash: fingerprintHash,
                            currentResponseSet: homographTraitResult.responseSet,
                            context: {
                                ip_address: '127.0.0.1'
                            }
                        })];
                case 20:
                    homographRes = _e.sent();
                    console.log('✅ Evasion Attempt Result:', {
                        decision: homographRes.data.decision,
                        trust_score: homographRes.data.trust_score,
                        signals: homographRes.data.signals
                    });
                    return [3 /*break*/, 22];
                case 21:
                    err_5 = _e.sent();
                    console.error('❌ Verification failed:', ((_d = err_5.response) === null || _d === void 0 ? void 0 : _d.data) || err_5.message);
                    return [3 /*break*/, 22];
                case 22:
                    // Cleanup Database
                    console.log('\n🧹 Cleaning up Database...');
                    return [4 /*yield*/, db.query('DELETE FROM agents WHERE fingerprint_hash = $1', [fingerprintHash])];
                case 23:
                    _e.sent();
                    return [4 /*yield*/, db.end()];
                case 24:
                    _e.sent();
                    console.log('\n🏁 Phase 1.5 Testing Complete.');
                    return [2 /*return*/];
            }
        });
    });
}
runTest().catch(console.error);
