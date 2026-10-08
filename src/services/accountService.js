import { accountMock } from '../data/mock/accounts.js'
import { createService } from './serviceFactory.js'
export const accountService=createService({endpoint:'/api/fake-accounts',mock:accountMock,collection:true})
