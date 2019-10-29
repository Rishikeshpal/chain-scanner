import { Block } from '../../db/entity/block'
import { Account } from '../../db/entity/account'
import { Thor } from '../../thor-rest'
import { Transfer, Energy } from '../../db/entity/movement'
import { displayID } from '../../utils'
import { EntityManager } from 'typeorm'
import { Snapshot } from '../../db/entity/snapshot'
import { SnapType } from '../../types'

export interface SnapAccount {
    address: string
    balance: string
    energy: string
    blockTime: number
    code: string | null
    master: string|null
}

export class BlockProcessor {
    public VETMovement: Transfer[] = []
    public EnergyMovement: Energy[] = []

    private acc = new Map<string, Account>()
    private snap = new Map<string, SnapAccount>()
    private code = new Set<string>()
    private balance = new Set<string>()

    constructor(
        readonly block: Block,
        readonly thor: Thor,
        readonly manager: EntityManager
    ) { }

    public async master(addr: string, master: string) {
        const acc = await this.account(addr)

        acc.master = master
        this.code.add(addr)
        return acc
    }

    public async transferVeChain(move: Transfer) {
        const senderAcc = await this.account(move.sender)
        const recipientAcc = await this.account(move.recipient)

        // touch sender's balance
        let balance = BigInt(senderAcc.balance) - BigInt(move.amount)
        if (balance < 0) {
            throw new Error(`Fatal: VET balance under 0 of Account(${move.sender}) at Block(${displayID(this.block.id)})`)
        }
        senderAcc.balance = balance

        // touch recipient's account
        balance = BigInt(recipientAcc.balance) + BigInt(move.amount)
        recipientAcc.balance = balance

        this.VETMovement.push(move)
    }

    public async transferEnergy(move: Energy) {
        await this.account(move.sender)
        await this.account(move.recipient)

        this.EnergyMovement.push(move)
    }

    public accounts() {
        const accs: Account[] = []
        for (const [_, acc] of this.acc.entries()) {
            accs.push(acc)
        }
        return accs
    }

    public async finalize() {
        for (const [_, acc] of this.acc.entries()) {
            const ret = await this.thor.getAccount(acc.address, this.block.id)
            acc.energy = BigInt(ret.energy)
            acc.blockTime = this.block.timestamp

            if (this.balance.has(acc.address)) {
                acc.balance = BigInt(ret.balance)
            }

            if (this.code.has(acc.address) && ret.hasCode) {
                const code = await this.thor.getCode(acc.address, this.block.id)
                if (code && code.code !== '0x') {
                    acc.code = code.code
                }
             }

        }
    }

    public snapshot(): Snapshot|null {
        const ret: object[] = []
        for (const [_, acc] of this.snap.entries()) {
            ret.push(acc)
        }

        if (!ret.length) {
            return null
        }

        const snap = new Snapshot()
        snap.blockID = this.block.id
        snap.type = SnapType.DualToken
        snap.data = ret

        return snap
    }

    public async touchAccount(addr: string) {
        await this.account(addr)
        return
    }

    private takeSnap(acc: Account) {
        this.snap.set(acc.address, {
            address: acc.address,
            balance: acc.balance.toString(10),
            energy: acc.energy.toString(10),
            blockTime: acc.blockTime,
            code: acc.code,
            master: acc.master
        })
    }

    private async account(addr: string) {
        if (this.acc.has(addr)) {
            return this.acc.get(addr)
        }

        const acc = await this.manager.getRepository(Account).findOne({ address: addr })
        if (acc) {
            this.acc.set(addr, acc)
            this.takeSnap(acc)
            return acc
        } else {
            // console.log(`Create Account(${addr}) at Block(${displayID(this.block.id)})`)
            const newAcc = this.manager.create(Account, {
                address: addr,
                balance: BigInt(0),
                energy: BigInt(0),
                code: null,
                master: null
            })

            if (this.block.number === 0) {
                this.balance.add(addr)
            }
            this.code.add(addr)
            this.acc.set(addr, newAcc)
            this.takeSnap(newAcc)
            return newAcc
        }
    }

}
