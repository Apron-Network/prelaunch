const truffleAssert = require('truffle-assertions');

const MerkleAirdrop = artifacts.require('MerkleAirdrop');
const ERC20Token = artifacts.require('ERC20Token');
const BN = web3.utils.BN;

const {combineProofs, merklize} = require('@apron/merkledrop-lib');

const bn1e18 = new BN('1000000000000000000');

contract('MerkleAirdrop', accounts => {
    let drop;
    let token;
    let testSetup;
    const root = accounts[0];
    const testData = [
        { address: accounts[1], amount: 123.4567 },
        { address: accounts[2], amount: 0.001 },
        { address: accounts[3], amount: 2.001 },
    ];
  
    before(async () => {
        drop = await MerkleAirdrop.deployed();
        token = await ERC20Token.deployed();
        // prepare
        await drop.setToken(token.address, root);
        await token.approve(drop.address, bn1e18.muln(99999));
        // add merkle airdrop
        testSetup = merklize(testData, 'address', 'amount');
        await drop.start(testSetup.root, 'mock-data-uri', 0);
    });

    it('should have enough ERC20 allowance', async () => {
        const bn0 = new BN(0);
        const [balance, allowance] = await Promise.all([
            token.balanceOf(root),
            token.allowance(root, drop.address)]);
        assert(balance.gt(bn0));
        assert(allowance.gt(bn0));
    });

    it('should have one airdrop', async () => {
        assert(await drop.airdropsCount() == 1);
    });

    it('allows users to claim airdrop', async () => {
        for (let i = 0; i < testData.length - 1; i++) {
            const award = testSetup.awards[i];
            const address = accounts[i+1];
            await drop.award(1, address, award.amountBN.toString(), award.proof);
            const received = await token.balanceOf(address);
            assert(received.toString() == award.amountBN.toString());
        }
    });

    it('allows a user to claim multiple airdrops', async () => {
        const testData1 = [{ address: accounts[4], amount: 1 }, { address: accounts[5], amount: 1 }];
        const testData2 = [{ address: accounts[4], amount: 1 }, { address: accounts[5], amount: 1 }];

        const setup1 = merklize(testData1, 'address', 'amount');
        const setup2 = merklize(testData2, 'address', 'amount');

        const id1 = (await drop.airdropsCount()).toNumber() + 1;
        const id2 = id1 + 1;

        await drop.start(setup1.root, 'mock-data-uri', 0);
        await drop.start(setup2.root, 'mock-data-uri', 0);

        const curAirdropId = await drop.airdropsCount();
        assert(curAirdropId.eq(new BN(id2)), 'Airdrop count mismatch');

        const { combinedProof, proofLengths } = combineProofs([setup1.awards[0].proof, setup2.awards[0].proof]);
        await drop.awardFromMany(
            [id1, id2], accounts[4],
            [setup1.awards[0].amountBN.toString(), setup2.awards[0].amountBN.toString()],
            combinedProof, proofLengths
        );

        const balanceBN = await token.balanceOf(accounts[4]);
        assert(balanceBN.eq(bn1e18.muln(2)), 'Wrong amount from airdrop');
    });

    it('refuses to claim when paused', async () => {
        await drop.setPause(1, true);

        const award = testSetup.awards[2];
        const address = accounts[3];
        await truffleAssert.reverts(
            drop.award(1, address, award.amountBN.toString(), award.proof),
            "PAUSED"
        );

        await drop.setPause(1, false);
        await drop.award(1, address, award.amountBN.toString(), award.proof);
        const received = await token.balanceOf(address);
        assert(received.toString() == award.amountBN.toString());
    });

    it('refuses to claim when locked', async () => {

        const testData1 = [{ address: accounts[4], amount: 1 }, { address: accounts[5], amount: 1 }];
        const setup1 = merklize(testData1, 'address', 'amount');
        const id1 = (await drop.airdropsCount()).toNumber() + 1;

        await drop.start(setup1.root, 'mock-data-uri', 500);

        const award = setup1.awards[0];
        const address = accounts[4];
        await truffleAssert.reverts(
            drop.award(id1, address, award.amountBN.toString(), award.proof),
            "LOCKED"
        );
    });

    it('refuses to change token without owner permission', async () => {
        await truffleAssert.reverts(
            drop.setToken(token.address, root, {from: accounts[1]}),
            "Ownable: caller is not the owner");
    });

    it('refuses to pause an airdrop without owner permission', async () => {
        await truffleAssert.reverts(
            drop.setPause(1, true, {from: accounts[1]}),
            "Ownable: caller is not the owner");
    });

});
