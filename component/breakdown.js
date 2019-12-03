import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {
  EntityStorageQuery,
  EntityStorageMutation,
  Modal,
  BlockText,
  Grid,
  GridItem,
  Icon,
  HeadingText,
  TableChart,
  Spinner,
  NerdGraphQuery,
  navigation,
  Button,
  Toast,
  TextField,
} from 'nr1';
import DimensionPicker from './dimensionPicker';
import SummaryBar from './summary-bar';
import { get } from 'lodash';
import { buildResults, buildGivingRisk } from './stat-utils';

function getIconType(apm) {
  if (apm.alertSeverity == 'NOT_ALERTING') {
    return Button.ICON_TYPE.HARDWARE_AND_SOFTWARE__SOFTWARE__SERVICE__S_OK;
  } else if (apm.alertSeverity == 'WARNING') {
    return Button.ICON_TYPE.HARDWARE_AND_SOFTWARE__SOFTWARE__SERVICE__S_WARNING;
  } else if (apm.alertSeverity == 'CRITICAL') {
    return Button.ICON_TYPE.HARDWARE_AND_SOFTWARE__SOFTWARE__SERVICE__S_ERROR;
  } else {
    return Button.ICON_TYPE.HARDWARE_AND_SOFTWARE__SOFTWARE__SERVICE;
  }
}

export default class Breakdown extends Component {
  static propTypes = {
    nerdletUrlState: PropTypes.object.isRequired,
    platformUrlState: PropTypes.object.isRequired,
    entity: PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props);
    this.state = {
      showConfig: false,
      eventType: 'PageView',
      donationValue: '',
      crmAttribute: null,
    };

    this._setAccount = this._setAccount.bind(this);
    this._setDimension = this._setDimension.bind(this);
    this._setEventType = this._setEventType.bind(this);
    this._selectAttribute = this._selectAttribute.bind(this);
    this._setDonationValue = this._setDonationValue.bind(this);
    this._setDonorAnalyzer = this._setDonorAnalyzer.bind(this);
    this._showDonor = this._showDonor.bind(this);
  }

  async componentDidMount() {
    const { entity } = this.props;
    const { entityGuid } = this.props.nerdletUrlState;

    // console.log(entity);
    EntityStorageQuery.query({
      entityGuid: entity.guid,
      collection: 'donor-analyzer-db',
    })
      .then(res => {
        if (Array.isArray(res.data) && res.data.length) {
          const { crmAttr, value } = res.data[0].document;
          this.setState({
            donationValue: value,
            crmAttribute: crmAttr,
          });
        } else {
          this.setState({ showConfig: true });
        }
      })
      .catch(err => {
        Toast.showToast({
          title: 'Unable to fetch data',
          description: err.message || '',
          type: Toast.TYPE.CRITICAL,
        });
      });

    if (entityGuid) {
      await this.loadEntity();
    } else {
      // get all user accessible accounts
      const gql = `{actor {accounts {name id}}}`;
      const { data } = await NerdGraphQuery.query({ query: gql });
      const { accounts } = data.actor;
      const account = accounts.length > 0 && accounts[0];
      this.setState({ accounts, account });
    }
  }

  _openDetails(pageUrl) {
    const { entity } = this.props;
    navigation.openStackedNerdlet({
      id: 'details',
      urlState: {
        pageUrl,
        entityGuid: entity.guid,
      },
    });
  }

  getQuery({ durationInMinutes }) {
    const {
      entity,
      nerdletUrlState: { pageUrl },
    } = this.props;
    const apdexTarget = entity.settings.apdexTarget || 0.5; // TO DO - Should we set a default value?
    const frustratedApdex = Math.round(apdexTarget * 4 * 10) / 10;
    const facetCase = `FACET CASES( WHERE duration <= ${apdexTarget} AS 'S', WHERE duration > ${apdexTarget} AND duration < ${frustratedApdex} AS 'T', WHERE duration >= ${frustratedApdex} AS 'F')`;

    const graphql = `{
      actor {
        account(id: ${entity.accountId}) {
          cohorts: nrql(query: "FROM PageView SELECT uniqueCount(session) as 'sessions', count(*)/uniqueCount(session) as 'avgPageViews', median(duration) as 'medianDuration', percentile(duration, 75, 95,99), count(*) WHERE appName='${
            entity.name
          }' ${
      pageUrl ? `WHERE pageUrl = '${pageUrl}'` : ''
    } ${facetCase} SINCE ${durationInMinutes} MINUTES AGO") {
            results
            totalResult
          }
          ${
            pageUrl
              ? `bounceRate:nrql(query: "FROM PageView SELECT funnel(session, ${
                  pageUrl ? `WHERE pageUrl = '${pageUrl}'` : ''
                } as 'page', ${
                  pageUrl ? `WHERE pageUrl != '${pageUrl}'` : ''
                } as 'nextPage') ${facetCase}") {
              results
          }`
              : ''
          }
          satisfied: nrql(query: "FROM PageView SELECT count(*), (max(timestamp)-min(timestamp)) as 'sessionLength' WHERE appName='${
            entity.name
          }' AND duration <= ${apdexTarget} ${
      pageUrl ? `WHERE pageUrl = '${pageUrl}'` : ''
    } FACET session limit MAX SINCE ${durationInMinutes} MINUTES AGO") {
            results
          }
          tolerated: nrql(query: "FROM PageView SELECT count(*), (max(timestamp)-min(timestamp)) as 'sessionLength' WHERE appName='${
            entity.name
          }' AND duration > ${apdexTarget} AND duration < ${frustratedApdex} ${
      pageUrl ? `WHERE pageUrl = '${pageUrl}'` : ''
    } FACET session limit MAX SINCE ${durationInMinutes} MINUTES AGO") {
            results
          }
          frustrated: nrql(query: "FROM PageView SELECT count(*), (max(timestamp)-min(timestamp)) as 'sessionLength' WHERE appName='${
            entity.name
          }' AND duration >= ${frustratedApdex} ${
      pageUrl ? `WHERE pageUrl = '${pageUrl}'` : ''
    } FACET session limit MAX SINCE ${durationInMinutes} MINUTES AGO") {
            results
          }
          frustratedSessions: nrql(query: "FROM PageView SELECT * WHERE appName='${
            entity.name
          }' AND duration >= ${frustratedApdex} ${
      pageUrl ? `WHERE pageUrl = '${pageUrl}'` : ''
    } limit MAX SINCE ${durationInMinutes} MINUTES AGO"){
            results
          }
        }
        entity(guid: "${entity.guid}") {
          ... on BrowserApplicationEntity {
            settings {
              apdexTarget
            }
            applicationId
            servingApmApplicationId
          }
          relationships {
            source {
              entity {
                domain
                guid
                type
                ... on ApmApplicationEntityOutline {
                  alertSeverity
                }
              }
            }
          }
        }
      }
    }`;

    return graphql;
  }

  _setAccount(account) {
    this.setState({ account });
  }

  _setEventType(eventType) {
    this.setState({
      eventType,
      dimension: null,
      filters: {},
      filterWhere: null,
    });
  }

  _setDimension(dimension) {
    this.setState({ dimension });
  }

  _setDonationValue(e) {
    this.setState({ donationValue: e.target.value });
  }

  _selectAttribute(attr) {
    this.setState({ crmAttribute: attr });
  }

  _setDonorAnalyzer() {
    const { entity } = this.props;
    const { donationValue, crmAttribute } = this.state;

    EntityStorageMutation.mutate({
      entityGuid: entity.guid,
      actionType: EntityStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
      collection: 'donor-analyzer-db',
      documentId: 'settings',
      document: {
        value: donationValue,
        crmAttr: crmAttribute,
      },
    })
      .then(() => this.setState({ showConfig: false }))
      .catch(err => {
        Toast.showToast({
          title: 'Unable to save settings',
          description: err.message || '',
          type: Toast.TYPE.CRITICAL,
        });
      });
  }

  _showDonor(data) {
    window.open(`http://google.com/${data}`, '_blank');
  }

  async loadEntity() {
    const { entityGuid } = this.props.nerdletUrlState;

    if (entityGuid) {
      // to work with mobile and browser apps, we need the
      // (non guid) id's for these applications, since guid is
      // not present in events like PageView, MobileSession, etc.
      const gql = `{
        actor {
          entity(guid: "${entityGuid}") {
            account {
              name
              id
            }
            name
            domain
            type
            guid
            ... on MobileApplicationEntity {
              applicationId
            }
            ... on BrowserApplicationEntity {
              applicationId
            }
            ... on ApmApplicationEntity {
              applicationId
            }
          }
        }
      }`;

      const { data } = await NerdGraphQuery.query({
        query: gql,
        fetchPolicyType: NerdGraphQuery.FETCH_POLICY_TYPE.NO_CACHE,
      });
      const { entity } = data.actor;
      await this.setState({ entity, account: entity.account });
    } else {
      this.setState({ entity: null });
    }
  }

  render() {
    const {
      entity,
      nerdletUrlState: { pageUrl },
      platformUrlState: {
        timeRange: { duration },
      },
    } = this.props;
    const durationInMinutes = duration / 1000 / 60;
    if (!entity) {
      //this shouldn't happen
      return <Spinner fillContainer />;
    }

    const query = this.getQuery({ durationInMinutes });

    return (
      <NerdGraphQuery query={query}>
        {({ data, loading, error }) => {
          if (loading) {
            return <Spinner fillContainer />;
          }
          if (error) {
            Toast.showToast({
              title: 'An error occurred.',
              type: Toast.TYPE.CRITICAL,
              sticky: true,
            });
            return (
              <div className="error">
                <HeadingText>An error occurred</HeadingText>
                <BlockText>
                  We recommend reloading the page and sending the error content
                  below to the Nerdpack developer.
                </BlockText>
                <div className="errorDetails">{JSON.stringify(error)}</div>
              </div>
            );
          }
          //debugger;
          const results = buildResults(data.actor.account);

          const { donationValue, crmAttribute } = this.state;
          const { frustratedSessions } = data.actor.account;
          const givingRisk = buildGivingRisk(frustratedSessions, donationValue);
          const { showConfig } = this.state;

          const {
            settings: { apdexTarget },
            servingApmApplicationId,
          } = entity;
          const frustratedApdex = Math.round(apdexTarget * 4 * 10) / 10;
          const browserSettingsUrl = `https://rpm.newrelic.com/accounts/${entity.accountId}/browser/${servingApmApplicationId}/edit#/settings`;
          const apmService = get(
            data,
            'actor.entity.relationships[0].source.entity'
          );
          if (apmService) {
            apmService.iconType = getIconType(apmService);
          }
          //console.debug("Data", [data, results]);
          return (
            <>
              {showConfig && (
                <Modal onClose={() => this.setState({ showConfig: false })}>
                  <HeadingText>Donor Analyzer Setup</HeadingText>
                  <TextField
                    label="Please enter your average donation amount."
                    spacingType={[TextField.SPACING_TYPE.MEDIUM]}
                    placeholder="0.00"
                    value={this.state.donationValue}
                    onChange={this._setDonationValue}
                  />
                  <DimensionPicker
                    {...this.props}
                    {...this.state}
                    selectAttribute={this._selectAttribute}
                  />
                  <Button
                    spacingType={[Button.SPACING_TYPE.MEDIUM]}
                    onClick={this._setDonorAnalyzer}
                    type={Button.TYPE.PRIMARY}
                    iconType={Button.ICON_TYPE.INTERFACE__SIGN__CHECKMARK}
                  >
                    Store Settings
                  </Button>
                </Modal>
              )}
              <Grid className="breakdownContainer">
                <GridItem columnSpan={12}>
                  <SummaryBar {...this.props} apmService={apmService} />
                </GridItem>
                <GridItem columnSpan={4} className="cohort satisfied">
                  <Icon
                    className="icon"
                    type={Icon.TYPE.PROFILES__EVENTS__LIKE}
                    color="green"
                  />
                  <h3 className="cohortTitle">Satisfied</h3>
                  <p className="cohortDescription">
                    <em>Satisfied</em> performance based on an{' '}
                    <a href={browserSettingsUrl} target="seldon">
                      apdex T of <em>{apdexTarget}</em>
                    </a>
                    .
                  </p>
                  <div className="cohortStats satisfiedStats">
                    <div className="cohortStat">
                      <span className="label">Sessions</span>
                      <span className="value">
                        {results.satisfied.sessions}
                      </span>
                    </div>
                    <div className="cohortStat">
                      <span className="label">Pgs / Session</span>
                      <span className="value">
                        {results.satisfied.avgPageViews}
                      </span>
                    </div>
                    <div className="cohortStat">
                      <span className="label">
                        {!pageUrl ? 'Bounce Rate' : 'Exit Rate'}
                      </span>
                      <span className="value">
                        {results.satisfied.bounceRate}%{!pageUrl ? '*' : ''}
                      </span>
                    </div>
                    <div className="cohortStat">
                      <span className="label">Avg. Session</span>
                      <span className="value">
                        {results.satisfied.avgSessionLength}*
                      </span>
                    </div>
                    <div className="cohortWideSection">
                      <h5 className="sectionTitle">Load Times</h5>
                      <div className="cohortStat">
                        <span className="label">Median</span>
                        <span className="value">
                          {results.satisfied.medianDuration}
                        </span>
                      </div>
                      <div className="cohortStat">
                        <span className="label">75th</span>
                        <span className="value">
                          {results.satisfied.duration75}
                        </span>
                      </div>
                      <div className="cohortStat">
                        <span className="label">95th</span>
                        <span className="value">
                          {results.satisfied.duration95}
                        </span>
                      </div>
                      <div className="cohortStat">
                        <span className="label">99th</span>
                        <span className="value">
                          {results.satisfied.duration99}
                        </span>
                      </div>
                    </div>
                  </div>
                </GridItem>
                <GridItem columnSpan={4} className="cohort tolerated">
                  <Icon
                    className="icon"
                    sizeType={Icon.SIZE_TYPE.NORMAL}
                    type={Icon.TYPE.INTERFACE__STATE__WARNING}
                    color="#F5A020"
                  />
                  <h3 className="cohortTitle">Tolerated</h3>
                  <p className="cohortDescription">
                    <em>Tolerated</em> performance based on an{' '}
                    <a href={browserSettingsUrl} target="seldon">
                      apdex T of <em>{apdexTarget}</em>
                    </a>
                    .
                  </p>
                  <div className="cohortStats toleratedStats">
                    <div className="cohortStat">
                      <span className="label">Sessions</span>
                      <span className="value">
                        {results.tolerated.sessions}
                      </span>
                    </div>
                    <div className="cohortStat">
                      <span className="label">Pgs / Session</span>
                      <span className="value">
                        {results.tolerated.avgPageViews}
                      </span>
                    </div>
                    <div className="cohortStat">
                      <span className="label">
                        {!pageUrl ? 'Bounce Rate' : 'Exit Rate'}
                      </span>
                      <span className="value">
                        {results.tolerated.bounceRate}%{!pageUrl ? '*' : ''}
                      </span>
                    </div>
                    <div className="cohortStat">
                      <span className="label">Avg. Session</span>
                      <span className="value">
                        {results.tolerated.avgSessionLength}*
                      </span>
                    </div>
                    <div className="cohortWideSection">
                      <h5 className="sectionTitle">Load Times</h5>
                      <div className="cohortStat">
                        <span className="label">Median</span>
                        <span className="value">
                          {results.tolerated.medianDuration}
                        </span>
                      </div>
                      <div className="cohortStat">
                        <span className="label">75th</span>
                        <span className="value">
                          {results.tolerated.duration75}
                        </span>
                      </div>
                      <div className="cohortStat">
                        <span className="label">95th</span>
                        <span className="value">
                          {results.tolerated.duration95}
                        </span>
                      </div>
                      <div className="cohortStat">
                        <span className="label">99th</span>
                        <span className="value">
                          {results.tolerated.duration99}
                        </span>
                      </div>
                    </div>
                  </div>
                </GridItem>
                <GridItem columnSpan={4} className="cohort frustrated">
                  <Icon
                    className="icon"
                    type={Icon.TYPE.INTERFACE__STATE__CRITICAL}
                    color="red"
                  />
                  <h3 className="cohortTitle">Frustrated</h3>
                  <p className="cohortDescription">
                    <em>Frustrated</em> performance based on an{' '}
                    <a href={browserSettingsUrl} target="seldon">
                      apdex T of <em>{apdexTarget}</em>
                    </a>
                    .
                  </p>
                  <div className="cohortStats frustratedStats">
                    <div className="cohortStat">
                      <span className="label">Sessions</span>
                      <span className="value">
                        {results.frustrated.sessions}
                      </span>
                    </div>
                    <div className="cohortStat">
                      <span className="label">Pgs / Session</span>
                      <span className="value">
                        {results.frustrated.avgPageViews}
                      </span>
                    </div>
                    <div className="cohortStat">
                      <span className="label">
                        {!pageUrl ? 'Bounce Rate' : 'Exit Rate'}
                      </span>
                      <span className="value">
                        {results.frustrated.bounceRate}%{!pageUrl ? '*' : ''}
                      </span>
                    </div>
                    <div className="cohortStat">
                      <span className="label">Avg. Session</span>
                      <span className="value">
                        {results.frustrated.avgSessionLength}*
                      </span>
                    </div>
                    <div className="cohortWideSection">
                      <h5 className="sectionTitle">Load Times</h5>
                      <div className="cohortStat">
                        <span className="label">Median</span>
                        <span className="value">
                          {results.frustrated.medianDuration}
                        </span>
                      </div>
                      <div className="cohortStat">
                        <span className="label">75th</span>
                        <span className="value">
                          {results.frustrated.duration75}
                        </span>
                      </div>
                      <div className="cohortStat">
                        <span className="label">95th</span>
                        <span className="value">
                          {results.frustrated.duration95}
                        </span>
                      </div>
                      <div className="cohortStat">
                        <span className="label">99th</span>
                        <span className="value">
                          {results.frustrated.duration99}
                        </span>
                      </div>
                    </div>
                  </div>
                </GridItem>
                <BlockText className="cohortsSmallPrint">
                  * Note that these calculations are approximations based on a
                  sample of the total data in New Relic for this Browser
                  application.
                </BlockText>
                {false ? null : (
                  <React.Fragment>
                    <GridItem className="pageUrlTable" columnSpan={8}>
                      <HeadingText type={HeadingText.TYPE.HEADING3}>
                        Imapcted Donors
                      </HeadingText>
                      <TableChart
                        className="tableChart"
                        accountId={entity.accountId}
                        fullheight
                        fullwidth
                        // eslint-disable-next-line prettier/prettier
                        query={`FROM PageView SELECT  ${crmAttribute.key}, session, duration, deviceType, pageUrl  WHERE appName='${entity.name}' AND duration >= ${frustratedApdex} ${pageUrl ? `WHERE pageUrl = '${pageUrl}'` : ''} limit MAX SINCE ${durationInMinutes} MINUTES AGO`}
                        onClickTable={(dataEl, row, chart) => {
                          this._showDonor(row[`${crmAttribute.key}`]);
                        }}
                      />
                    </GridItem>
                    <GridItem columnSpan={4} className="cohort improvement">
                      <Icon
                        className="icon"
                        type={Icon.TYPE.INTERFACE__STATE__WARNING}
                        color="red"
                      />
                      <h3 className="cohortTitle">Frustrated Giving</h3>
                      <p className="cohortDescription">
                        Based on an average donation of ${donationValue} and a
                        Frustrated bounce rate of{' '}
                        {results.frustrated.bounceRate}% the{' '}
                        {results.frustrated.sessions} Frustrated sessions place.
                      </p>
                      <div className="cohortStats giving">
                        <div className="givingRisk">
                          <span className="label">Giving at Risk</span>
                          <span className="value">
                            ${givingRisk.riskAmount}
                          </span>
                        </div>
                      </div>
                    </GridItem>
                  </React.Fragment>
                )}
              </Grid>
            </>
          );
        }}
      </NerdGraphQuery>
    );
  }
}
