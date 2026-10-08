import { accountMock } from '../data/mock/accounts.js'
import { createService } from './serviceFactory.js'
import { getAegisAccounts } from './aegisAdapter.js'
export const accountService=createService({endpoint:'/api/fake-accounts',mock:accountMock,collection:true,api:{list:getAegisAccounts}})
