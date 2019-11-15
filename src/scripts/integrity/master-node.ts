import { initConnection } from '../../explorer-db'
import { getConnection, LessThanOrEqual } from 'typeorm'
import { Thor } from '../../thor-rest'
import { SimpleNet } from '@vechain/connex.driver-nodejs'
import { Persist } from '../../processor/master-node/persist'
import { AuthorityAddress, authority } from '../../const'
import { Authority } from '../../explorer-db/entity/authority'
import { Block } from '../../explorer-db/entity/block'

const thor = new Thor(new SimpleNet('http://localhost:8669'))
const persist = new Persist()

const get = async (master: string, revision: string) => {
    const ret = await thor.explain({
        clauses: [{
            to:  AuthorityAddress,
            value: '0x0',
            data: authority.get.encode(master)
        }]
    }, revision)
    const getRet = authority.get.decode(ret[0].data)
    return { master, listed: getRet.listed, endorsor: getRet.endorsor, identity: getRet.identity }
}

initConnection().then(async (conn) => {
    const head = await persist.getHead()
    let count = 0

    const nodes = await getConnection()
        .getRepository(Authority)
        .find()

    for (const node of nodes) {
        const chain = await get(node.address, head.toString())
        if (chain.listed !== node.listed) {
            throw new Error(`Fatal: Master(${node.address} listed status mismatch, want ${node.listed} got ${chain.listed}`)
        }
        if (chain.listed) {
            count++
        }
        const signed = await getConnection()
            .getRepository(Block)
            .count({ signer: node.address, isTrunk: true, number: LessThanOrEqual(head) })
        if (node.signed !== signed) {
            throw new Error(`Fatal: Master(${node.address} signed block count mismatch, want ${node.signed} got ${signed}`)
        }
    }

    console.log(`Total master: ${nodes.length}, inPower: ${count}`)
    console.log('all done!')

}).then(() => {
    process.exit(0)
}).catch(e => {
    console.log('Integrity check: ')
    console.log(e)
    process.exit(-1)
})