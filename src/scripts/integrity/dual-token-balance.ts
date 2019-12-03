import { createConnection, getManager, Transaction } from 'typeorm'
import { Persist } from '../../processor/dual-token/persist'
import { Thor } from '../../thor-rest'
import { Account } from '../../explorer-db/entity/account'
import { PrototypeAddress, ZeroAddress, prototype } from '../../const'
import { Net } from '../../net'
import { getNetwork, checkNetworkWithDB } from '../network'
import { getThorREST } from '../../utils'

const net = getNetwork()
const persist = new Persist()

createConnection().then(async (conn) => {
    const thor = new Thor(new Net(getThorREST()), net)
    await checkNetworkWithDB(net)

    const {head, accounts} = await new Promise((resolve, reject) => {
        conn.manager.transaction('SERIALIZABLE', async manager => {
            const h = (await persist.getHead(manager))!
            const accs = await manager
                .getRepository(Account)
                .find()
            resolve({head: h, accounts: accs})
        }).catch(reject)
    })
    const block = await thor.getBlock(head)

    let count = 0
    console.log('start checking...')
    for (let acc of accounts) {
        let chainAcc: Connex.Thor.Account
        let chainCode: Connex.Thor.Code
        let chainMaster: string | null = null
        let chainSponsor: string | null = null
        try {
            chainAcc = await thor.getAccount(acc.address, head.toString())
            chainCode = await thor.getCode(acc.address, head.toString())
            let ret = await thor.explain({
                clauses: [{
                    to: PrototypeAddress,
                    value: '0x0',
                    data: prototype.master.encode(acc.address)
                }]
            }, head.toString())
            let decoded = prototype.master.decode(ret[0].data)
            if (decoded['0'] !== ZeroAddress) {
                chainMaster = decoded['0']
            }

            ret = await thor.explain({
                clauses: [{
                    to: PrototypeAddress,
                    value: '0x0',
                    data: prototype.currentSponsor.encode(acc.address)
                }]
            }, head.toString())
            decoded = prototype.currentSponsor.decode(ret[0].data)
            const sponsor = decoded['0']
            if (sponsor !== ZeroAddress) {
                ret = await thor.explain({
                    clauses: [{
                        to: PrototypeAddress,
                        value: '0x0',
                        data: prototype.isSponsor.encode(acc.address, sponsor)
                    }]
                }, head.toString())
                decoded = prototype.isSponsor.decode(ret[0].data)
                if (decoded['0'] === true) {
                    chainSponsor = sponsor
                }
            }
        } catch {
            continue
        }
        const txCount = await conn
            .getRepository(Transaction)
            .createQueryBuilder('tx')
            .where({ origin: acc.address })
            .leftJoin('tx.block', 'block')
            .andWhere('block.isTrunk = :isTrunk', { isTrunk: true })
            .andWhere('block.number <= :number', { number: head })
            .getCount()

        if (acc.txCount !== txCount) {
            throw new Error(`Fatal: txCount mismatch of Account(${acc.address})  sum:${txCount} got:${acc.txCount}`)
        }

        if (acc.balance !== BigInt(chainAcc.balance)) {
            throw new Error(`Fatal: balance mismatch of Account(${acc.address}) chain:${chainAcc.balance} db:${acc.balance}`)
        }
        if (acc.blockTime < block.timestamp) {
            acc.energy =
                acc.energy
                + BigInt(5000000000) * acc.balance * BigInt(block.timestamp - acc.blockTime)
                / BigInt(1e18)
        }
        if (acc.energy !== BigInt(chainAcc.energy)) {
            throw new Error(`Fatal: energy mismatch of Account(${acc.address}) chain:${chainAcc.energy} db:${acc.energy}`)
        }
        if (acc.master !== chainMaster) {
            throw new Error(`Fatal: master of Account(${acc.address}) mismatch,chain:${chainMaster} db:${acc.master}`)
        }
        if (acc.sponsor !== chainSponsor) {
            // tslint:disable-next-line: max-line-length
            throw new Error(`Fatal: sponsor of Account(${acc.address}) mismatch,chain:${chainSponsor} db:${acc.sponsor}`)
        }
        if (chainAcc.hasCode === true && acc.code !== chainCode.code) {
            throw new Error(`Fatal: Account(${acc.address}) code mismatch`)
        }

        count++
        if (count % 1000 === 0) {
            console.log('checked ', count)
        }
    }
    console.log('all done!')
}).then(() => {
    process.exit(0)
}).catch((e: Error) => {
    console.log('Integrity check: ')
    console.log(e)
    process.exit(-1)
})
