import { domainMock } from '../data/mock/domains.js'
import { createService } from './serviceFactory.js'
export const domainService=createService({endpoint:'/api/domains',mock:domainMock,collection:true})
