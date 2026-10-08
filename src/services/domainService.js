import { domainMock } from '../data/mock/domains.js'
import { createService } from './serviceFactory.js'
import { getAegisDomains } from './aegisAdapter.js'
export const domainService=createService({endpoint:'/api/domains',mock:domainMock,collection:true,api:{list:getAegisDomains}})
