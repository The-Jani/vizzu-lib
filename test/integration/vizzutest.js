const AggregateError = import('aggregate-error');

const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const fetch = require('node-fetch');

const Workspace = require('./modules/host/workspace.js');
const Chrome = require('./modules/browser/chrome.js');


class TestSuite {

    #workspace;
    
    #testCasesPath;
    #testCases = [];

    #testSuiteResults = { 'passed': [], 'failed': [] };

    #browser;


    constructor(testCasesPath) {
        if(path.isAbsolute(testCasesPath)) {
            this.#testCasesPath = testCasesPath;
        } else {
            this.#testCasesPath = __dirname + '/' + testCasesPath;
        }
        this.#setTestCases(this.#testCasesPath);
    }
  

    getTestCasesPath() {
        return this.#testCasesPath;
    }

    #setTestCases(testCasesPath) {
        if (fs.lstatSync(testCasesPath).isDirectory()) {
            let files = fs.readdirSync(testCasesPath);
            files.forEach(file => {
                if (fs.lstatSync(testCasesPath + '/' + file).isDirectory()) {
                    this.#setTestCases(testCasesPath + '/' + file);
                }
                else {
                    if (path.extname(file) == '.mjs') {
                        this.#testCases.push(path.relative(this.#testCasesPath, testCasesPath + '/' + path.parse(file).name));
                    }
                }
            })
        }
    }

    #filterTestCases(filters) {
        let ans = [];
        if (filters.length == 0) {
            ans = this.#testCases;
        } else {
            filters.forEach(filter => {
                let testCaseWithExt = filter.split('test_cases/')[1];
                let testCase = testCaseWithExt.slice(0, -path.extname(testCaseWithExt).length);
                if (this.#testCases.includes(testCase)) {
                    if (!ans.includes(testCase)) {
                        ans.push(testCase);
                    }
                }
            });
        }
        return ans;
    }

    getTestCases() {
        return this.#testCases;
    }

    async runTestSuite() {
        try {
            let testCases = this.#filterTestCases(argv._)
            console.log('Selected Test Cases: ' + testCases);
            if (testCases.length > 0) {
                this.#startTestSuite();
                for (let i = 0; i < testCases.length; i++) {
                    await this.#runTestCase(testCases[i]);
                }
            }
        } catch (err) {
            throw err;
        } finally {
            this.#finishTestSuite();
        }
    }

    #startTestSuite() {
        this.#workspace = new Workspace(__dirname + '/../../');
        this.#workspace.openWorkspace();
        console.log('Listening at http://127.0.0.1:' + String(this.#workspace.getWorkspacePort()));
        this.#browser = new Chrome();
        this.#browser.openBrowser(!argv.disableHeadlessBrowser);
    }

    #finishTestSuite() {
        let errs = [];
        try {
            this.#createTestSuiteResults();
        } catch (err) {
            errs.push(err);
        }
        try {
            if(typeof this.#browser !== 'undefined') {
                this.#browser.closeBrowser();
            }
        } catch (err) {
            errs.push(err);
        }
        try {
            if(typeof this.#workspace !== 'undefined') {
                this.#workspace.closeWorkspace();
            }
        } catch (err) {
            errs.push(err);
        }
        if (errs.length > 1) {
            throw new AggregateError(errs);
        } else if (errs.length == 1) {
            throw errs[0];
        }
    }

    #createTestSuiteResults() {
        const sum = this.#testSuiteResults.passed.length + this.#testSuiteResults.failed.length
        if (this.#testSuiteResults.passed.length != sum) {
            console.error('PASSED : ' + sum + '/' + this.#testSuiteResults.passed.length + 
                    ', FAILED : ' + sum + '/' + this.#testSuiteResults.failed.length)
            process.exitCode = 1;
        } else {
            console.log('PASSED : ' + sum + '/' + this.#testSuiteResults.passed.length + 
                    ', FAILED : ' + sum + '/' + this.#testSuiteResults.failed.length)
        }
    }

    async #runTestCase(testCase) {
        let testSuiteResultPath = __dirname + '/test_report/' + testCase;
        let testCaseData = await this.#runTestCaseClient(testCase, argv.vizzuUrl);
        let testCaseResult = this.#getTestCaseResult(testCaseData);
        fs.rmdirSync(testSuiteResultPath, { recursive: true });

        if (testCaseResult == 'PASSED') {
            console.log(testCase + ' : ' + testCaseResult);
            this.#testSuiteResults.passed.push(testCase);
        } else if (testCaseResult == 'WARNING - reference hash does not exist') {
            console.warn(testCase + ' : ' + testCaseResult);
            this.#testSuiteResults.passed.push(testCase);
        } else {
            console.error(testCase + ' : ' + testCaseResult);
            this.#testSuiteResults.failed.push(testCase);
        }

        if (!argv.disableReport) {
            if (testCaseResult == 'FAILED' || testCaseResult == 'WARNING - reference hash does not exist') {
                fs.mkdirSync(testSuiteResultPath, { recursive: true });
                this.#createTestCaseReport(testSuiteResultPath, testCase, testCaseData, false);
                if (testCaseResult == 'FAILED') {
                    try {
                        let sha = await fetch('https://vizzu-lib-main.storage.googleapis.com/lib/sha');
                        let vizzuUrl = 'https://vizzu-lib-main-sha.storage.googleapis.com/lib-' + await sha.text();
                        let refData = await this.#runTestCaseClient(testCase, vizzuUrl);
                        this.#createTestCaseReport(testSuiteResultPath, testCase, refData, true);
                    } catch (err) {
                        console.error(err);
                    }
                }
            }
        }
    }

    async #runTestCaseClient(testCase, vizzuUrl) {
        await this.#browser.getUrl('http://127.0.0.1:' + String(this.#workspace.getWorkspacePort())
            + '/test/integration/modules/client/index.html'
            + '?testCase=' + testCase
            + '&vizzuUrl=' + vizzuUrl);
            const now = Date.now();
            const timeout = 60000;
            while (true) {
                if (Date.now() > now + timeout) {
                    return { result: 'TIMEOUT' };
                }
                let testCaseData= await this.#browser.executeScript('if (window.hasOwnProperty("testData")) { return testData } else { return \'undefined\' }');
                if (testCaseData != 'undefined') {
                    return testCaseData;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
    }

    #getTestCaseResult(testCaseData) {
        if (testCaseData.result != 'FINISHED') {
            return testCaseData.result;
        } else {
            for (let i = 0; i < testCaseData.seeks.length; i++) {
                for (let j = 0; j < testCaseData.seeks[i].length; j++) {
                    if (testCaseData.references[i][j] == '') {
                        return 'WARNING - reference hash does not exist'
                    }
                    if (testCaseData.hashes[i][j] != testCaseData.references[i][j]) {
                        return 'FAILED'
                    }
                }
            }
        }
        return 'PASSED'
    }

    #createTestCaseReport(testSuiteResultPath, testCase, testCaseData, isRef) {
        let fileAdd = ''
        if (isRef) {
            fileAdd = '-ref'
        }
        let hashList = [];
        for (let i = 0; i < testCaseData.seeks.length; i++) {
            hashList[i] = {};
            for (let j = 0; j < testCaseData.seeks[i].length; j++) {
                hashList[i][testCaseData.seeks[i][j]] = testCaseData.hashes[i][j];
                if (isRef) {
                    hashList[i][testCaseData.seeks[i][j]] = testCaseData.references[i][j];
                }
                fs.writeFile(testSuiteResultPath + '/' + testCase + '_' + i + '_' + testCaseData.seeks[i][j] + fileAdd + ".png", testCaseData.images[i][j].substring(22), 'base64', err => {
                    if (err) {
                        throw err;
                    }
                });
            }
        }
        hashList = JSON.stringify(hashList, null, 4);
        fs.writeFile(testSuiteResultPath + '/' + testCase + fileAdd + '.json', hashList, (err) => {
            if (err) {
                throw err;
            }
        });
    }
}


try {
    var argv = yargs
        .usage('Usage: $0 [test_cases] [options]')

        .example('$0', 'Run all tests in the test_cases folder')
        .example('$0 test_cases/*', 'Run all tests in the test_cases folder')
        .example('$0 test_cases/example.mjs', 'Run example.mjs')
        .example('$0 test_cases/exampl?.mjs', 'Run example.mjs')
        
        .help('h')
        .alias('h', 'help')
        .version('0.0.1')
        .alias('v', 'version')
        .boolean('b')
        .alias('b', 'disableHeadlessBrowser')
        .default('b', false)
        .describe('b', 'Disable to use headless browser')
        .boolean('r')
        .alias('r', 'disableReport')
        .default('r', false)
        .describe('r', 'Disable to create detailed report')
        .alias('u', 'vizzuUrl')
        .describe('u', 'Change vizzu.js url')
        .nargs('u', 1)
        .default('u', '/example/lib')
        .argv;

    let test = new TestSuite(__dirname + '/test_cases');
    test.runTestSuite(argv);
} catch (err) {
    console.error(err);
    process.exitCode = 1;
}  